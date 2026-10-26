#!/usr/bin/env node

// image-api.mjs — generate or edit one image straight through the OpenAI Images API with OPENAI_API_KEY,
// for when Codex's subscription quota is used up or nearly so (codex-visual.mjs prints CODEX_VISUAL_QUOTA: low).
// The caller writes the prompt and picks the model; nothing here judges the picture.
//
//   node image-api.mjs --model gpt-image-2.5-sunburst --prompt-file brief.txt --out out.png
//        [--image in.png ...] [--mask mask.png] [--size 1536x1024] [--quality high]
//
// With --image it calls /v1/images/edits (every input image is sent; the first is the one edited),
// otherwise /v1/images/generations. Prints IMAGE_API_MODEL, IMAGE_API_ARTIFACT and IMAGE_API_USAGE lines
// and writes <out>.json beside the picture (model, endpoint, size, quality, usage, prompt).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function parseArgs(argv) {
  const options = { images: [], size: "auto", quality: "high" };
  const single = { "--model": "model", "--prompt": "prompt", "--prompt-file": "promptFile", "--mask": "mask", "--size": "size", "--quality": "quality", "--out": "out" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--image" && value) {
      options.images.push(value);
      i++;
    } else if (single[flag] && value) {
      options[single[flag]] = value;
      i++;
    } else {
      throw new Error(`Unknown or incomplete argument "${flag}".`);
    }
  }
  if (options.promptFile) options.prompt = fs.readFileSync(options.promptFile, "utf8");
  for (const key of ["model", "prompt", "out"]) {
    if (!options[key]) throw new Error(`Missing --${key === "prompt" ? "prompt or --prompt-file" : key}.`);
  }
  if (!/^gpt-image-/.test(options.model)) throw new Error(`--model must be a GPT Image model, not "${options.model}".`);
  return options;
}

const fileBlob = (file) => {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Not an image the API takes: ${file}`);
  return new Blob([fs.readFileSync(file)], { type: mime });
};

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  const edit = options.images.length > 0;
  const endpoint = edit ? "/v1/images/edits" : "/v1/images/generations";
  let body;
  const headers = { Authorization: `Bearer ${key}` };
  if (edit) {
    body = new FormData();
    body.append("model", options.model);
    body.append("prompt", options.prompt);
    body.append("size", options.size);
    body.append("quality", options.quality);
    const field = options.images.length > 1 ? "image[]" : "image";
    for (const file of options.images) body.append(field, fileBlob(file), path.basename(file));
    if (options.mask) body.append("mask", fileBlob(options.mask), path.basename(options.mask));
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ model: options.model, prompt: options.prompt, size: options.size, quality: options.quality });
  }
  const response = await fetch(`https://api.openai.com${endpoint}`, { method: "POST", headers, body });
  const result = await response.json();
  if (!response.ok) throw new Error(`${endpoint} ${response.status}: ${result.error?.message ?? JSON.stringify(result)}`);
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${endpoint} returned no image.`);
  const out = path.resolve(options.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  const record = {
    model: options.model,
    endpoint,
    size: options.size,
    quality: options.quality,
    images: options.images,
    mask: options.mask ?? null,
    usage: result.usage ?? null,
    prompt: options.prompt
  };
  fs.writeFileSync(`${out}.json`, JSON.stringify(record, null, 2));
  console.log(`IMAGE_API_MODEL: ${options.model}`);
  console.log(`IMAGE_API_ARTIFACT: ${out}`);
  console.log(`IMAGE_API_USAGE: ${JSON.stringify(result.usage ?? {})}`);
}

const invokedDirectly = () => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  }
};

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

export { parseArgs };
