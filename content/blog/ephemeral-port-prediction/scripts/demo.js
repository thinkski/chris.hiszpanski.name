// Copyright 2020 Chris Hiszpanski. All rights reserved.

'use strict';

// Port of reciprocal_scale() in include/linux/kernel.h
function reciprocal_scale(val, ep_ro) {
  return Math.floor((val * ep_ro) / Math.pow(2, 32));
}

function uint32(x) {
  return x - Math.floor(x / Math.pow(2, 32)) * Math.pow(2, 32);
}

// Map [0, 2^32) -> [low, high)
function deflate(x, low, high) {
  return reciprocal_scale(x, high - low + 1) + low;
}

// Map [low, high) -> [0, 2^32)
function inflate(x, low, high) {
  return uint32(Math.ceil((x - low) * Math.pow(2, 32) / (high - low + 1)));
}

// Return number of leading zero bits
function leading_zeros(x) {
  var count = 0;

  while (x) {
    x = x >>> 1;
    count++;
  }

  return 32 - count;
}

// port -> bit vector of most significant (unchanged) bits
function marshal(sample, low, high) {
  const sig = significant(sample, low, high);

  sample = inflate(sample, low, high);

  let arr = [];
  for (let i = 0; i < sig; i++) {
    arr.push((uint32(1 << 31) & uint32(sample << i)) >= 0 ? 0 : 1);
  }

  return arr;
}

// bit vector to state vector
function unmarshal(vec) {
  let result = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    let z = 0;
    for (let j = 0; j < 32; j++) {
      if (0 != vec[32 * i + j]) {
        z = (z << 1) | 1;
      } else {
        z = (z << 1) | 0;
      }
    }
    result[i] = z;
  }
  return result;
}

// Minimal GF(2) matrix class
class Matrix {
  constructor (rows, cols) {
    this._nrows = rows;
    this._ncols = cols;
    this._data = new Uint8Array(rows * cols);
    this._data.fill(0);
  }

  // Computes rank of matrix in row-reduced echelon form
  rank() {
    let result = 0;
    for (let row = 0; row < this._nrows; row++) {
      const isZero = (x) => x == 0;
      if (!this._data.slice(row * this._ncols, (row+1) * this._ncols).every(isZero)) {
        result++;
      }
    }

    return result;
  }

  // Gets m[row, col]
  getAt(row, col) {
    return this._data[row * this._ncols + col];
  }

  // Sets m[row, col] = x
  setAt(row, col, x) {
    this._data[row * this._ncols + col] = x;
  }

  // Computes row-reduced echelon form
  rowReduce(y) {
    let prow = 0;
    let pcol = 0;

    while (prow < this._nrows && pcol < this._ncols) {
      let pivot;
      let found = false;

      // Find pivot (i.e. first row with non-zero in column pcol)
      for (pivot = prow; pivot < this._nrows; pivot++) {
        if (0 != this._data[pivot * this._ncols + pcol]) {
          found = true;
          break;
        }
      }

      if (!found) {
        // No pivot found
        pcol++;
      } else {
        // Swap rows
        for (let col = 0; col < this._ncols; col++) {
          [ this._data[prow  * this._ncols + col],
            this._data[pivot * this._ncols + col] ] =
          [ this._data[pivot * this._ncols + col],
            this._data[prow  * this._ncols + col] ];
        }
        if (typeof(y) != 'undefined') {
          [ y[prow], y[pivot] ] = [ y[pivot], y[prow] ];
        }

        for (let i = prow + 1; i < this._nrows; i++) {
          // Add pivot row to all rows where pivot column is non-zero
          if (0 != this._data[i * this._ncols + pcol]) {
            for (let j = pcol; j < this._ncols; j++) {
              this._data[i * this._ncols + j] ^= this._data[prow * this._ncols + j];
            }
            if (typeof(y) != 'undefined') {
              y[i] ^= y[prow];
            }
          }
        }
        prow++;
        pcol++;
      }
    }

    return y;
  }

  dump() {
    for (let row = 0; row < this._nrows; row++) {
      console.log(this._data.slice(row * this._ncols, (row + 1) * this._ncols));
    }
  }

  print() {
    let s = '';
    for (let row = 0; row < this._nrows; row++) {
      for (let col = 0; col < this._ncols; col++) {
        s += this._data[row * this._ncols + col].toString(2);
      }
      s += '\n';
    }
    console.log(s);
  }

  // m * x = y, solve for x
  solve(y) {
    let startRow = 0;
    let startCol = 0;

    // First lowest right 1
    for (let row = this._nrows - 1; row > 0; row--) {
      for (let col = this._ncols - 1; col > 0; col--) {
        if (0 != this._data[row * this._ncols + col]) {
          startRow = row;
          startCol = col;
          break;
        }
      }
      if (0 != startRow || 0 != startCol) {
        break;
      }
    }

    for (let row = startRow; row > 0; row--) {
      for (let col = startCol; col > 0; col--) {
        if (this._data[row * this._ncols + col]) {
          for (let irow = row - 1; irow >= 0; irow--) {
            if (0 != this._data[irow * this._ncols + col]) {
              this._data[irow * this._ncols + col] ^= this._data[row * this._ncols + col];
              y[irow] ^= y[row];
            }
          }
          break;
        }
      }
    }

    // Compute x from identity-like m and b
    let x = new Uint8Array(this._ncols);
    for (let col = 0; col < this._ncols; col++) {
      for (let row = 0; row < this._nrows; row++) {
        if (0 != this._data[row * this._ncols + col]) {
          x[col] = y[row];
          break;
        }
      }
    }

    return x;
  }
}

// Returns number of usable most-significant bits.
function significant(x, low, high) {
  const lower = inflate(x, low, high);
  const upper = inflate(x+1, low, high) - 1;

  return leading_zeros(lower ^ upper);
}

// LFSR-113: Maximally-Equidistributed Combined LFSR Generators
function* lfsr113(s1, s2, s3, s4) {
  function tausworthe(s, a, b, c, d) {
    return ((s & c) << d) ^ (((s << a) ^ s) >>> b)
  }

  while(true) {
    s1 = tausworthe(s1,  6, 13, 0xfffffffe, 18);
    s2 = tausworthe(s2,  2, 27, 0xfffffff8,  2);
    s3 = tausworthe(s3, 13, 21, 0xfffffff0,  7);
    s4 = tausworthe(s4,  3, 12, 0xffffff80, 13);
    yield uint32(s1 ^ s2 ^ s3 ^ s4);
  }
}

// @param range
function createGeneratorMatrix(samples, low, high) {
  let seed = new Uint32Array(4);

  // Compute total number of bits of information in all samples
  let bitsPerSample = [];
  let totalBits = 0;
  for (const sample of samples) {
    const sig = significant(sample, low, high);
    bitsPerSample.push(sig);
    totalBits += sig;
  }

  // New matrix. Rows are output bit equations. Columns are state bits.
  let m = new Matrix(totalBits, 128);

  // For each state variable
  for (let z = 0; z < 4; z++) {
    // For each bit of state variable
    for (let i = 31; i >= 0; i--) {
      // Set i-th bit of seed
      seed[0] = 0; seed[1] = 0; seed[2] = 0; seed[3] = 0;
      seed[z] = uint32(1 << i);

      // Create new generator, only setting i-th bit of seed
      const rng = lfsr113(seed[0], seed[1], seed[2], seed[3]);

      let rowOffset = 0;
      for (let n = 0; n < samples.length; n++) {
        let sample;
        // Compute n-th iteration of tausworthe generator
        sample = rng.next().value;
        sample = rng.next().value;

        // Positions of n-th sample which are sums of i-th bit of state
        for (let j = 0; j < bitsPerSample[n]; j++) {
          if ((uint32(1 << 31) & uint32(sample << j)) != 0) {
            let row = rowOffset + j;
            let col = (32 * z) + (31 - i);
            m.setAt(row, col, m.getAt(row, col) ^ 1);
          }
        }
        rowOffset += bitsPerSample[n];
      }
    }
  }

  return m;
}

// https://stackoverflow.com/questions/14071463/how-can-i-merge-typedarrays-in-javascript
function mergeTypedArrays(a, b) {
  // Checks for truthy values on both arrays
  if(!a && !b) throw 'Please specify valid arguments for parameters a and b.';

  // Checks for truthy values or empty arrays on each argument
  // to avoid the unnecessary construction of a new array and
  // the type comparison
  if(!b || b.length === 0) return a;
  if(!a || a.length === 0) return b;

  // Make sure that both typed arrays are of the same type
  if(Object.prototype.toString.call(a) !== Object.prototype.toString.call(b))
    throw 'The types of the two arguments passed for parameters a and b do not match.';

  var c = new a.constructor(a.length + b.length);
  c.set(a);
  c.set(b, a.length);

  return c;
}

// https://stackoverflow.com/questions/10073699/pad-a-number-with-leading-zeros-in-javascript
function pad(n, width, z) {
  z = z || '0';
  n = n + '';
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

function printSeed(state) {
  let str = ''
  for (const s of state) {
    str += '0x' + pad(s.toString(16), 8) + ' ';
  }
  console.log(str);
}

// Ephemeral Port Prediction
// @param samples Array of sequential ephemeral port samples.
// @param low Low-end of assumed ephemeral port range (inclusive).
// @param high High-end of assumed ephemeral port range (inclusive).
function dephemeral(samples, low, high) {
}

function validateForm() {
  // Pure client-side form. Not designed to be sent to a server, so suppress.
  event.preventDefault();

  // Validate lower bound of port range
  let low = Number(document.forms["demo"]["portRangeLow"].value);
  if (low < 0 || 65535 < low) {
    alert("Lower bound of ephemeral port range must be between 0 and 65535, inclusive.");
    return false;
  }

  // Validate upper bound of port range
  let high = Number(document.forms["demo"]["portRangeHigh"].value);
  if (high < 0 || 65535 < high) {
    alert("Upper bound of ephemeral port range must be between 0 and 65535, inclusive.");
    return false;
  }

  // Validate that lower bound < upper bound
  if (high <= low) {
    alert("Upper bound must be greater than lower bound.");
    return false;
  }

  // Validate samples
  let samples = [];
  for (let i = 1; i <= 10; i++) {
    let sample = Number(document.forms["demo"]["sample" + i.toString(10)].value);
    if ((0 == sample) || null == samples || undefined === sample) continue;
    if ((sample < low) || (high < sample)) {
      alert(`Sample ${i} is not within specified ephemeral port range.`);
      return false;
    }
    samples.push(sample);
  }

  // Convert samples into information bit vector (i.e. y in w * x = y)
  let y = [];
  for (const sample of samples) {
    y = y.concat(marshal(sample, low, high));
  }

  // Compute number of significant bits in all samples (varies with sample)
  let totalBits = 0;
  for (const sample of samples) {
    totalBits += significant(sample, low, high);
  }
  if (totalBits < 113) {
    alert(`Specified samples contain ${totalBits} of information, ` +
          "but 113 are required. Please specify additional ports.");
    return false;
  }

  // Compute generator matrix
  // Rows are output bit equations. Columns are state bits.
  let w = createGeneratorMatrix(samples, low, high);

  // Compute row-reduced echelon form and then validate matrix rank.
  y = w.rowReduce(y)
  let rank = w.rank();
  if (rank != 113) {
    alert(`Generator matrix rank is ${rank}, but expected to be 113. Please report this.`);
    return false;
  }

  // Solve for x
  let x = unmarshal(w.solve(y));
  if (4 != x.length) {
    alert("Malformed result. Please report this.");
    return false;
  }
 
  // Write predictions for next six ports to readonly form "inputs"
  {
    const rng = lfsr113(x[0], x[1], x[2], x[3]);
    let sample;

    // re-predict 10 given samples
    for (let i = 0; i < 10; i++) {
      sample = rng.next().value;
      sample = rng.next().value;
    }
    for (let i = 0; i < 6; i++) {
      sample = rng.next().value;
      sample = rng.next().value;
      document.forms["demo"]["sample" + (i+11).toString(10)].value =
        deflate(sample, low, high);
    }
  }

  // Write result to readonly form "inputs"
  for (let i = 0; i < 4; i++) {
    document.forms["demo"]["state" + (i+1).toString(10)].value = "0x" + pad(x[i].toString(16), 8);
  }

  return true;
}
