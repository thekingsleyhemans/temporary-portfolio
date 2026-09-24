const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const rootDirectory = __dirname;
const mediaDirectories = fs
  .readdirSync(rootDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name))
  .map((entry) => entry.name);

const convertVideo = (inputPath, outputPath) => {
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

    let stderrOutput = '';
    process.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString();
    });

    process.on('close', (exitCode) => {
      if (exitCode === 0) {
        console.log(`${path.relative(rootDirectory, inputPath)} -> ${path.relative(rootDirectory, outputPath)}`);
        resolve();
        return;
      }

      reject(new Error(`FFmpeg failed for ${path.relative(rootDirectory, inputPath)}:\n${stderrOutput || ''}`));
    });
  });
};

(async () => {
  for (const directoryName of mediaDirectories) {
    const mediaDirectory = path.join(rootDirectory, directoryName);
    const videoFiles = fs
      .readdirSync(mediaDirectory)
      .filter((file) => file.toLowerCase().endsWith('.mp4'));

    for (const videoFile of videoFiles) {
      const inputPath = path.join(mediaDirectory, videoFile);
      const outputPath = path.join(mediaDirectory, `${path.basename(videoFile, '.mp4')}.webm`);

      await convertVideo(inputPath, outputPath);
    }
  }
})();