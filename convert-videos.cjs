const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const mediaDirectory = path.join(__dirname, 'benokes');
const videoFiles = fs
  .readdirSync(mediaDirectory)
  .filter((file) => file.toLowerCase().endsWith('.mp4'));

const convertVideo = (inputFile) => {
  const inputPath = path.join(mediaDirectory, inputFile);
  const outputPath = path.join(mediaDirectory, `${path.basename(inputFile, '.mp4')}.webm`);

  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      '-c:v', 'libvpx-vp9',
      '-crf', '32',
      '-b:v', '0',
      '-c:a', 'libopus',
      '-b:a', '96k',
      outputPath,
    ]);

    process.stderr.on('data', (chunk) => {
      process.stderrOutput = `${process.stderrOutput || ''}${chunk}`;
    });

    process.on('close', (exitCode) => {
      if (exitCode === 0) {
        console.log(`${inputFile} -> ${path.basename(outputPath)}`);
        resolve();
        return;
      }

      reject(new Error(`FFmpeg failed for ${inputFile}:\n${process.stderrOutput || ''}`));
    });
  });
};

(async () => {
  for (const videoFile of videoFiles) {
    await convertVideo(videoFile);
  }
})();