#!/bin/sh
set -eu
mkdir -p build-posix
cd build-posix
curl --fail --location --retry 3 -o ffmpeg-8.0.1.tar.xz https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz
tar -xf ffmpeg-8.0.1.tar.xz
mv ffmpeg-8.0.1 ffmpeg
cd ffmpeg
./configure --disable-autodetect --disable-network --disable-doc --disable-debug \
  --disable-shared --enable-static --disable-x86asm --disable-everything \
  --enable-ffmpeg --enable-ffprobe --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,aac,mp3,mpegts,ogg \
  --enable-muxer=mp4,mov,matroska \
  --enable-parser=aac,h264,hevc,av1,vp9,opus,mpegaudio \
  --enable-bsf=aac_adtstoasc,extract_extradata,h264_mp4toannexb \
  --enable-decoder=h264,aac,hevc,vp9,av1,opus,mp3
make -j4
./ffmpeg -version > ../ffmpeg-config.txt
