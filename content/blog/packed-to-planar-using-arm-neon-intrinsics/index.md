---
title: "Packed-to-Planar Conversion Using ARM NEON Intrinsics"
date: 2019-08-09T02:01:38-07:00
mathjax: true
tags: [ "video" ]
---

Many embedded video camera drivers produce a packed pixel format known as YUYV
(sometimes referred to as YUY2). However, some H.264 video decoders, for
example QuickTime Player, only support the planar YUV 4:2:0 pixel format
(sometimes referred to as I420). So a fast converter (operating on each pixel
of each frame) between the two pixel formats is needed.

<!--more-->

I'll discuss the two formats and show how ARM® NEON intrinsics can be used to
efficiently convert between the two. I used this technique to achieve
realtime 25 fps at 720p H.264 encoding on a Google Coral EdgeTPU, which uses
an NXP i.MX8M, a system-on-chip (SoC) without a H.264 hardware encoder.

{{< alert color="blue" >}}
This is a pedagogic technique as it still consumes a fair amount of CPU
resources compared to GPU based approaches, which I'll discuss later.
{{< /alert >}}

## Background

First, what is Y, U, and V? Y stands for "luminance", or light intensity
&mdash; think grayscale television. It is a holdover from early television
days when a 3D (X,Y,Z) coordinate system was used &mdash; the y-axis
represented luminence in this coordinate system. U and V are orthogonal color
channels:

{{< figure class="block mx-auto max-w-md" link="https://en.wikipedia.org/wiki/YUV" src="images/vu-plane.png" caption="Source: Wikipedia.com user Tonyle (Creative Commons BY-SA 3.0)" >}}

Now let's take a 4x4 pixel YUV 4:2:0 image as an example:

{{< figure class="block max-w-md mx-auto" src="images/4x4.png" >}}

Notice how each pixel in the image gets its own Y value, but the U and V
pixels are shared amongst 2x2 groups of 4 pixels --- it's as if U and V are
half the resolution of Y.

Now, for a hardware device like a CMOS image sensor, the most straighforward
way to output this data is to interleave it:

{{< figure class="block max-w-md mx-auto" src="images/packed.png" >}}

But for compression, its best to have values which will be similar as a block,
so a planar format is more desirable as natural images have spatial coherance:

{{< figure class="block max-w-lg mx-auto" src="images/planar.png" >}}

So some reordering is required. And this reordering needs to happen for each
frame from the sensor, so it best be fast. We'll be using ARM NEON
[SIMD](https://en.wikipedia.org/wiki/SIMD) instructions to get the speed we
need.


## Implementation

Since code is worth a thousand words, here is the basic approach for
packed-to-planar conversion:

{{< highlight c >}}
//////////////////////////////////////////////////////////////////////////////
//
// Convert YUYV to YUV420P
//
// YUYV is a packed format, where luma and chroma are interleaved, 8-bits per
// pixel:
//
//     YUYVYUYV...
//     YUYVYUYV...
//     ...
//
// Color is subsampled horizontally.
//
//
// YUV420 is a planar format, and the most common H.264 colorspace. For each
// 2x2 square of pixels, there are 4 luma values and 2 chroma values. Each
// value is 8-bits; however, there are 4*8 + 8 + 8 = 48 bits total for 4
// pixels, so on average there are effectively 12-bits per pixel:
//
// YYYY...  U.U..   V.V..
// YYYY...  .....   .....
// YYYY...  U.U..   V.V..
// YYYY...  .....   .....
// .......  .....   .....
//
// Arguments:
// y:      Pointer to planar destination buffer for luma.
// yuyv:   Pointer to packed source buffer.
// stride: Stride (in bytes) of source buffer.
//
// Copyright 2019 Chris Hiszpanski. All rights reserved.
//
//////////////////////////////////////////////////////////////////////////////

void yuyv_to_yuv420p(
    uint8_t *y, uint8_t *u, uint8_t *v,
    uint8_t *yuyv,
    int stride, int height
) {
    for (int row = 0; row < height; row += 2) {
        unpack_even(y, u, v, yuyv, stride);
        y    += stride / 2;
        u    += stride / 4;
        v    += stride / 4;
        yuyv += stride;

        unpack_odd(y, yuyv, stride);
        y    += stride / 2;
        yuyv += stride;
    }
}
{{< /highlight >}}

Notice how odd and even rows are treated differently --- since our eyes have more rods than cones,
and thus have more luminance than color resolution, video frames allocate two times more space to
luma than chroma.

Now for the good stuff. Here is an inline function using ARM NEON intrinsics
to unpack odd numbered rows. Briefly, an intrinsic is a function which compiles
to one or more specialized SIMD assembly instructions:

{{< highlight c >}}
//////////////////////////////////////////////////////////////////////////////
//
// Unpack an odd row. Odd rows contain only luma.
//
// Arguments:
// y:      Pointer to planar destination buffer for luma.
// yuyv:   Pointer to packed source buffer.
// stride: Stride (in bytes) of source buffer.
//
// Copyright 2019 Chris Hiszpanski. All rights reserved.
//
//////////////////////////////////////////////////////////////////////////////

inline static void unpack_odd(uint8_t *y, uint8_t *yuyv, int stride) {
#if defined(__ARM_NEON)
    for (int i = 0; i < stride; i += 32) {
        vst1q_u8(y, vld2q_u8(yuyv).val[0]);

        yuyv += 32;
        y    += 16;
    }
#else
    for (int i = 0; i < stride; i += 4) {
        *y++ = *yuyv++;
        yuyv++;
        *y++ = *yuyv++;
        yuyv++;
    }
#endif
}
{{< /highlight >}}

I'll leave the even rows as an exercise to the reader.


## Results

The results are encouraging. Running a test on the Google Coral EdgeTPU and
using libx264 for H.264 baseline encoding, without NEON instrisics the frame
rate topped out at ~5 frames/sec. This is on par with the frame rate achieved
by ffmpeg. Repeating the test using NEON intrinsics, the frame rate topped out
at over 27 frames/sec --- real-time as the sensor outputs 25 frames/sec. Nearly a 6x speed up and the difference between a choppy and smooth video call.

However, this approach does suffer from heavy CPU usage. In a future post I'll
show how packed-to-planar conversion can be more efficiently achieved with an
OpenGL ES 3.1 compute shader in the GPU.
