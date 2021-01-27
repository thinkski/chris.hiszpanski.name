+++
title = "Ephemeral Port Prediction"
tags = [ "random" ]
date = 2020-04-05T03:12:25-07:00
mathjax = true
scripts = [ "js/ephemeral-port-prediction/demo.js" ]
+++

When a TCP/IP client connects to a new remote host and port, it must select a
local port to use for the connection. Usually, any free port will do, so most
applications leave local port selection to the kernel. The kernel selects a
port at random from the
[ephemeral port](https://en.wikipedia.org/wiki/Ephemeral_port) range. Except
the selection isn't really random. As it turns out, the selected port can be
predicted in advance, revealing kernel state information.

## Simple client

First, let's write a simple client to gather some real data. This client will
create a UDP socket and connect it to a remote. As this is a UDP socket, no
packets will be sent, but a local port will be selected for the connection.

{{< highlight c >}}
// client.c: Simple socket client. Creates socket and prints local source port.

#include <stdio.h>      // printf
#include <stdlib.h>     // atoi
#include <unistd.h>     // close
#include <arpa/inet.h>  // ntohs
#include <sys/socket.h> // connect, socket

void sample() {
    // Create socket
    int sockfd;
    if (sockfd = socket(PF_INET, SOCK_DGRAM, IPPROTO_UDP), -1 == sockfd) {
        perror("socket");
    }

    // Connect to remote. This does NOT actually send a packet.
    const struct sockaddr_in raddr = {
        .sin_family = AF_INET,
        .sin_port   = 0xbeef,     // arbitrary remote port
        .sin_addr   = 0xbeefbeef  // arbitrary remote host
    };
    if (-1 == connect(sockfd, (const struct sockaddr *)&raddr, sizeof(raddr))) {
        perror("connect");
    }

    // Display selected ephemeral port
    const struct sockaddr_in laddr;
    socklen_t laddr_len = sizeof(laddr);
    if (-1 == getsockname(sockfd, (struct sockaddr *)&laddr, &laddr_len)) {
        perror("getsockname");
    }
    printf("local port: %i\n", ntohs(laddr.sin_port));

    // Close socket
    close(sockfd);
}

int main() {
	for (int i = 0; i < 16; i++) {
		sample();
	}

	return 0;
}
{{< /highlight >}}

This program opens a socket 16 times back to back. We see that a unique, random
looking source port is selected each time:

```
$ gcc -std=c99 -o client client.c && ./client
local port: 41039
local port: 46915
local port: 41778
local port: 39273
local port: 38680
local port: 37939
local port: 37757
local port: 45454
local port: 58115
local port: 42947
local port: 47022
local port: 45395
local port: 55042
local port: 52648
local port: 59649
local port: 58293
```

Each port is selected from the ephemeral port range (default is 32768 to
60999, inclusive), which on Linux can be
obtained via:

```
$ cat /proc/sys/net/ipv4/ip_local_port_range
32768	60999
```

And indeed, each port above is within this range. Now, let's go deeper into
understanding how these source ports were selected.

## Port Selection Algorithm

The precise mechanism through which ephemeral ports are selected isn't
standardized -- every implementation, in theory, may do something different.
On Linux, this happens within `net/ipv4/udp.c` in
[`udp_lib_get_port()`](https://github.com/torvalds/linux/blob/v5.4/net/ipv4/udp.c#L226-L338). This code is very mature now and hasn't changed much in nearly 25
years.

The highlighted lines below select the ephemeral port (unless the
port is already in use, but this is rare on all but the most loaded machines,
so to keep things simple let's ignore it for now).

```c
/**
 *  udp_lib_get_port  -  UDP/-Lite port lookup for IPv4 and IPv6
 *
 *  @sk:          socket struct in question
 *  @snum:        port number to look up
 *  @hash2_nulladdr: AF-dependent hash value in secondary hash chains,
 *                   with NULL address
 */
int udp_lib_get_port(struct sock *sk, unsigned short snum,
		     unsigned int hash2_nulladdr)
{
	struct udp_hslot *hslot, *hslot2;
	struct udp_table *udptable = sk->sk_prot->h.udp_table;
	int    error = 1;
	struct net *net = sock_net(sk);

	if (!snum) {
		int low, high, remaining;
		unsigned int rand;
		unsigned short first, last;
		DECLARE_BITMAP(bitmap, PORTS_PER_CHAIN);

		inet_get_local_port_range(net, &low, &high);
		remaining = (high - low) + 1;

		rand = prandom_u32();
		first = reciprocal_scale(rand, remaining) + low;
```

The first checked ephemeral port is `first`. If it is available, as is usually
the case, it will be used. `reciprocal_scale(x, y)` takes a 32-bit unsigned
integer `x` and linearly scales it to fit the interval [0, `y`). Thus, `first`
is the 32-bit unsigned integer returned by `prandom_u32()`, linearly scaled to
the interval [`low`, `high`].

As for the random number, it is produced by a "maximally equidistributed
combined Tausworthe generator", a
combination of four simpler Tausworthe generators, more commonly known as
[linear feedback shift registers](https://en.wikipedia.org/wiki/Linear-feedback_shift_register).
The generator is implemented in 
[`lib/random32.c`](https://github.com/torvalds/linux/blob/v5.4/lib/random32.c)
&mdash; here are the two most relevant functions:

```c
/**
 *	prandom_u32_state - seeded pseudo-random number generator.
 *	@state: pointer to state structure holding seeded state.
 *
 *	This is used for pseudo-randomness with no outside seeding.
 *	For more random results, use prandom_u32().
 */
u32 prandom_u32_state(struct rnd_state *state)
{
#define TAUSWORTHE(s, a, b, c, d) ((s & c) << d) ^ (((s << a) ^ s) >> b)
	state->s1 = TAUSWORTHE(state->s1,  6U, 13U, 4294967294U, 18U);
	state->s2 = TAUSWORTHE(state->s2,  2U, 27U, 4294967288U,  2U);
	state->s3 = TAUSWORTHE(state->s3, 13U, 21U, 4294967280U,  7U);
	state->s4 = TAUSWORTHE(state->s4,  3U, 12U, 4294967168U, 13U);

	return (state->s1 ^ state->s2 ^ state->s3 ^ state->s4);
}
EXPORT_SYMBOL(prandom_u32_state);

/**
 *	prandom_u32 - pseudo random number generator
 *
 *	A 32 bit pseudo-random number is generated using a fast
 *	algorithm suitable for simulation. This algorithm is NOT
 *	considered safe for cryptographic use.
 */
u32 prandom_u32(void)
{
	struct rnd_state *state = &get_cpu_var(net_rand_state);
	u32 res;

	res = prandom_u32_state(state);
	put_cpu_var(net_rand_state);

	return res;
}
EXPORT_SYMBOL(prandom_u32);
```

The generator uses four 32-bit state variables (i.e. 128-bit seed) and has a
period of 2<sup>113</sup>. Because the generator is maximally equidistributed,
each 32-bit sample occurs as often as any other in any sequence,
approximately 2<sup>113</sup> &middot; 2<sup>-32</sup> &rArr; 2<sup>81</sup>
times. Similarly, each sequence of two samples occurs approximately
2<sup>113</sup> &middot; 2<sup>-32</sup> &middot; 2<sup>-32</sup> &rArr;
2<sup>49</sup> times. More generally, each sequence of _n_ samples occurs
approximately 2<sup>113 - 32<i>n</i></sup> times.
Thus, with a sequence of only four samples, we should be able to uniquely
determine the four state variables (i.e. the seed).

Because this is a linear generator, it can be precisely described by a
[generator matrix](https://en.wikipedia.org/wiki/Generator_matrix), ___G___, where the generator matrix can be multiplied by the current seed,
___x___, to yield one or more samples of output, depending on the number
of rows in the generator matrix:

<center><b><i>y</i></b> = <b><i>G</i></b> &middot; <b><i>x</i></b></center>

If we can compute ___G___ and observe ___y___, we can then solve for
___x___ using
[Gaussian elimination](https://en.wikipedia.org/wiki/Gaussian_elimination).
Once we know __x__, we know where we are in the sequence &mdash; we can
predict all future port choices.

### From Port Values To State Variables

Unfortunately, we cannot actually observe the state variables, at least not
without modifying the kernel --- we can only observe the selected port.

However, we know that the 32-bit output from `prandom_u32()` maps to the
ephemeral port range via `reciprical_scale()`:

```c
// @file include/linux/kernel.h

/**
 * reciprocal_scale - "scale" a value into range [0, ep_ro)
 * @val: value
 * @ep_ro: right open interval endpoint
 *
 * Perform a "reciprocal multiplication" in order to "scale" a value into
 * range [0, @ep_ro), where the upper interval endpoint is right-open.
 * This is useful, e.g. for accessing a index of an array containing
 * @ep_ro elements, for example. Think of it as sort of modulus, only that
 * the result isn't that of modulo. ;) Note that if initial input is a
 * small value, then result will return 0.
 *
 * Return: a result based on @val in interval [0, @ep_ro).
 */
static inline u32 reciprocal_scale(u32 val, u32 ep_ro)
{
	return (u32)(((u64) val * ep_ro) >> 32);
}
```

Say the ephemeral port range is the default --- 32768 to 60999, inclusive. In
this case, a `prandom_u32` output of `0x00000000` would map to port 32768.
`0x00025243` would also map to port 32768. But `0x00025244` would map to port
32769. This tells us something. If the observed source port is 32768, the
upper 14 bits of the corresponding number output by `prandom_u32` must be 0,
as all 32-bit values that map to 32768 share the same 14 most significant bits
--- all zero.

It's important to note that not all port values provide equal information. For
instance, `prandom_u32` values between `0x00025244` and `0x0004a486`,
inclusive, all map to port 32769, but here only the 13 most significant bits
are shared -- the 14th most significant bit could be a 0 or a 1.

In the worst case, `0x7FFFFFFF` and `0x80000000` would both map to the same
port, meaning observing that port value would not provide any meaningful
information.

As long as we can gather 128-bits of information about sequential values from
`prandom_u32`, we can infer its seed. Assuming the default port range, port
values provide 12.843 bits of information, on average. Thus, with 10
observations, we expect to be able to infer the seed.

### Core Affinity

One more snag is that `prandom_u32()` uses `get_cpu_var()` and `put_cpu_var()` to
get and set state variables, respectively. As the function names imply, each
CPU maintains its own independent state --- there's no guarantee that two
sequential samples are from the same CPU. However, in practice, [processor
affinity](https://en.wikipedia.org/wiki/Processor_affinity) means the same CPU
is used for multiple back-to-back calls to `prandom_u32()`. For instance, on
a six core (12 due to hyper-threading) Intel i7-5820K, often hundreds of
milliseconds, and occasionally multiple seconds, may elapse between core
changes:

{{< figure src="images/hist1.png" caption="`getcpu()` sampled at 10 Hz for 60 minutes." >}}

Furthermore, CPU changes do not appear to be random either. On the same Intel
i7-5820K, the CPU used by the sampling process monotonically increases modulo
the number of cores.

{{< figure src="images/line1.png" caption="`getcpu()` sampled at 10 Hz for 60 seconds." >}}

So in practice, if the generator is rapidly sampled in succession, there is a
good chance all samples will be from the same core.

Scheduling and CPU affinity are architecture specific. On a quad-core `armv7`,
the sampling process was assigned to a core and never switched cores. It would
be interesting to explore how CPU affinity differs in practice between
architectures.

## Demo

Using the first ten sequential ports sampled earlier by our client, we can now
compute the random number generator's state.

<form class="w-100" name="demo">
  <p>Enter ephemeral port range:</p>

  <div class="flex flex-row flex-wrap items-center mb-4">
  	<input class="flex-grow w-1/3" type="number" name="portRangeLow" value=32768
  	       required>
  	<div class="px-3">&mdash;</div>
  	<input class="flex-grow w-1/3" type="number" name="portRangeHigh" value=60999
  	       required>
  </div>

  <p>Enter 10 sequential ephemeral port samples:</p>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample1">1</label>
  	<input class="flex-grow" type="number" name="sample1" value=41039>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample2">2</label>
  	<input class="flex-grow" type="number" name="sample2" value=46915>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample3">3</label>
  	<input class="flex-grow" type="number" name="sample3" value=41778>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample4">4</label>
  	<input class="flex-grow" type="number" name="sample4" value=39273>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample5">5</label>
  	<input class="flex-grow" type="number" name="sample5" value=38680>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample6">6</label>
  	<input class="flex-grow" type="number" name="sample6" value=37939>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample7">7</label>
  	<input class="flex-grow" type="number" name="sample7" value=37757>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample8">8</label>
  	<input class="flex-grow" type="number" name="sample8" value=45454>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample9">9</label>
  	<input class="flex-grow" type="number" name="sample9" value=58115>
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample10">10</label>
  	<input class="flex-grow" type="number" name="sample10" value=42947>
  </div>

  <div class="flex justify-end">
    <button class="btn-secondary mr-2" type="reset">Reset</button>
    <button class="btn-primary ml-2" type="submit" onclick="validateForm();">Compute</button>
  </div>

  <p>Next six predicted port selections:</p>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample11">11</label>
  	<input class="flex-grow" type="number" name="sample11">
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample12">12</label>
  	<input class="flex-grow" type="number" name="sample12">
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample13">13</label>
  	<input class="flex-grow" type="number" name="sample13">
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample14">14</label>
  	<input class="flex-grow" type="number" name="sample14">
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample15">15</label>
  	<input class="flex-grow" type="number" name="sample15">
  </div>

  <div class="flex items-center mb-4">
  	<label class="w-8" for="sample16">16</label>
  	<input class="flex-grow" type="number" name="sample16">
  </div>

  <p>Linux kernel <code>prandom_u32()</code> seed (i.e. four 32-bit state variables in code
  above:</p>

  <div class="flex flex-row flex-wrap items-center">
    <div class="flex items-center mb-2">
  	  <label class="mx-2" for="state1">s1</label>
  	  <input class="flex-grow mono w-32" type="text" name="state1" readonly>
  	</div>
    <div class="flex items-center mb-2">
  	  <label class="mx-2" for="state2">s2</label>
  	  <input class="flex-grow mono w-32" type="text" name="state2" readonly>
  	</div>
    <div class="flex items-center mb-2">
  	  <label class="mx-2" for="state3">s3</label>
  	  <input class="flex-grow mono w-32" type="text" name="state3" readonly>
  	</div>
    <div class="flex items-center mb-2">
  	  <label class="mx-2" for="state4">s4</label>
  	  <input class="flex-grow mono w-32" type="text" name="state4" readonly>
  	</div>
  </div>
</form>
{{< script src="scripts/demo.js" >}}

## Conclusions and Future Work

With less than a dozen TCP/IP connections, it is possible to determine the
secret state of the random number generator of a remote client's kernel.

This technique could, in theory, be used to establish peer-to-peer connectivity
between peers behind symmetric NATs, thus saving on bandwidth cost.

It also raises potential security implications. In one scenario, while
visiting a malicious website, a client could unwittingly execute JavaScript
code that created 10 unique connections to a server. These connections could
enable the server owner to learn the secret state of the random number
generator of the client's kernel. This generator serves as a common source of
randomness for numerous languages (e.g. Python). This is an area that could
use further exploration.

Finally, this work only considered the vanilla Linux kernel. It would be
worthwhile to analyze how ephemeral ports are selected in other operating
systems.
