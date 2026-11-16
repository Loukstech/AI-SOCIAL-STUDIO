import { render, resolveFfmpegPath, type RenderJob, type VideoFormat } from './render.js';

function readClips(value: string): RenderJob['clips'] {
  return value.split(',').map((part) => {
    const [start, end] = part.split(/[-:]/);
    return { start: Number(start), end: Number(end) };
  });
}

function main(): void {
  const [input, output, ...flags] = process.argv.slice(2);
  if (!input || !output) {
    console.error(
      'Usage : node dist/cli.js <entrée.mp4> <sortie.mp4> [--format PORTRAIT|SQUARE|LANDSCAPE] [--clips 0-10,20-30] [--srt sous-titres.srt]',
    );
    process.exitCode = 1;
    return;
  }

  const job: RenderJob = {
    input,
    output,
    clips: [{ start: 0, end: 30 }],
    format: 'PORTRAIT',
  };

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (!value) break;
    if (flag === '--format') job.format = value as VideoFormat;
    else if (flag === '--clips') job.clips = readClips(value);
    else if (flag === '--srt') job.subtitles = value;
    index += 1;
  }

  render(job)
    .then((path) => console.log(`Vidéo rendue : ${path} (ffmpeg : ${resolveFfmpegPath()})`))
    .catch((cause: unknown) => {
      console.error(cause instanceof Error ? cause.message : cause);
      process.exitCode = 1;
    });
}

main();
