/**
 * image-generator Skill
 * 支持自定义配置优先 + 内置 7 key 自动平滑降级
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";

const DEFAULT_API_BASE = "https://apihub.agnes-ai.com/v1/images/generations";
const STATE_DIR = process.env.OPENCLAW_STATE_DIR
  || path.join(process.env.OPENCLAW_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir(), '.openclaw');
const SAVE_DIR = path.join(STATE_DIR, 'image-output');

function loadMediaPrefs(kind) {
  try {
    const fname = kind === 'video' ? 'video-generator.json' : 'media-generator.json';
    const p = path.join(STATE_DIR, fname);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return {};
}

// 内置 7 API keys 轮询
const BUILTIN_API_KEYS = [
  "sk-95sX8HnNOhh8FFfAm3ccOgGFg6MA8yf7zU5PEEQdGxSuKhQY",
  "sk-z2NHJlR99oODMYvS9C5u8qLMNf6hmc9vRm5JenvHHStTfxZn",
  "sk-ct7MSvbC8LqL1gGqJuoVCKgjtecXwbjIUZhXQ0gITEaksCS0",
  "sk-nZtkk9AAyZl3sbkv8Gw4R1R99NnkgUWhRGL4Cp0Dl7LSPsUu",
  "sk-Y6ORz4nnuXHUpwjdXv2WlmLMwCfPBMtmh69iuXxZkQtZazyV",
  "sk-GhS6TUB6W8LibJT5whDhbUvmYW3csM0HdGDdjotpgadQbd2F",
  "sk-HV5HINAfAhMJOnYxYp83ZXDLqeudt8ofLtdm9Bj5p9SUOUGh",
];

export default function createPlugin(apiOrRuntime) {
  const api = apiOrRuntime && typeof apiOrRuntime.registerTool === 'function' ? apiOrRuntime : null;
  const runtime = api?.runtime ?? apiOrRuntime;
  const skill = createSkill(runtime);

  if (api) {
    api.registerTool({
      name: 'draw_picture',
      description: skill.description + ' Use when the user asks to generate, draw, or create an image.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', description: 'Image description (required)' },
          model: { type: 'string', description: 'Model id, e.g. agnes-image-2.0-flash' },
          size: { type: 'string', description: '512x512, 1024x1024, 1024x1792, 1792x1024' },
          quality: { type: 'string', description: 'standard or hd' },
          style: { type: 'string', description: 'vivid or natural' },
          n: { type: 'number', description: 'Number of images (1-4)' },
        },
      },
      async execute(_toolCallId, params) {
        const result = await skill.draw_picture(params || {});
        const files = (result.files || []).map((f) => f.filepath).filter(Boolean);
        const mediaHint = files.length ? `\nMEDIA:${files.join('\nMEDIA:')}` : '';
        return {
          content: [{ type: 'text', text: JSON.stringify(result) + mediaHint }],
          details: result,
        };
      },
    });
    return { name: skill.name };
  }

  return skill;
}

export function createSkill(runtime) {
  if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
  }

  const customConfig = {
    ...(runtime?.config?.imageGenerator || {}),
    ...loadMediaPrefs('image'),
  };
  const rawKey = (customConfig.apiKey || '').trim();
  const isBuiltInKey = !rawKey
    || rawKey === 'sk-builtin-agnes-key-mask'
    || BUILTIN_API_KEYS.includes(rawKey);
  const userApiKey = isBuiltInKey ? null : rawKey;
  const userApiBase = customConfig.apiBase || null;
  const customModel = customConfig.model || null;

  return {
    name: "image-generator",
    description: "Generate images via agnes-ai or user-customized API with parameter control and key rotation",

    instruction: `当用户要求生成图片时使用此技能。支持以下参数控制：

- prompt (必填): 图片描述文本
- model: 模型名称
- size (默认 "1024x1024"): 尺寸
- quality (默认 "standard"): 质量
- style (默认 "vivid"): 风格
- n (默认 1): 生成数量，1-4`,

    async draw_picture({
      prompt,
      model,
      size = "1024x1024",
      quality = "standard",
      style = "vivid",
      n = 1,
      output_dir,
    }) {
      const dir = output_dir || SAVE_DIR;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const selectedModel = model || customModel || "agnes-image-2.0-flash";
      const timestamp = Date.now();
      const results = [];

      const cleanModel = selectedModel.includes('/') ? selectedModel.split('/').pop() : selectedModel;
      const body = {
        model: cleanModel,
        prompt,
        size,
        n: Number(n),
      };
      if (quality) body.quality = quality;
      if (style) body.style = style;

      console.log(`[image-generator] Generating: ${prompt} | model=${selectedModel} | size=${size} | count=${n}`);

      const images = await callImageAPIWithRetry(body, n, userApiKey, userApiBase);

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const filename = `image_${timestamp}_${i + 1}.png`;
        const filepath = path.join(dir, filename);

        await downloadImage(img.url || img.b64_json, filepath, img.b64_json);

        results.push({
          filepath,
          filename,
          index: i + 1,
        });
      }

      console.log(`[image-generator] Images saved to: ${dir}`);

      return {
        success: true,
        files: results,
        prompt,
        model: selectedModel,
        size,
        count: results.length,
      };
    },
  };
}

async function callImageAPIWithRetry(body, count, userApiKey, userApiBase) {
  if (userApiKey) {
    try {
      const targetBase = resolveImageApiUrl(userApiBase);
      return await callImageAPI(body, userApiKey, count, targetBase);
    } catch (err) {
      console.warn(`[image-generator] Custom API key failed: ${err.message}, falling back to built-in keys`);
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt < BUILTIN_API_KEYS.length; attempt++) {
    const apiKey = BUILTIN_API_KEYS[attempt % BUILTIN_API_KEYS.length];
    try {
      return await callImageAPI(body, apiKey, count, DEFAULT_API_BASE);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`All image API keys failed. Last error: ${lastError?.message}`);
}

function resolveImageApiUrl(userApiBase) {
  const base = String(userApiBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
  if (base.endsWith('/images/generations')) return base;
  if (base.endsWith('/images')) return `${base}/generations`;
  if (base.endsWith('/v1')) return `${base}/images/generations`;
  if (!base.includes('/generations')) return `${base}/generations`;
  return base;
}

function callImageAPI(body, apiKey, count, apiBaseUrl) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(apiBaseUrl);
    const transport = urlObj.protocol === "https:" ? https : http;

    const req = transport.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(responseData);
            if (res.statusCode >= 200 && res.statusCode < 300 && parsed.data) {
              resolve(parsed.data);
            } else {
              const msg = parsed.error?.message || parsed.message || `HTTP ${res.statusCode}`;
              reject(new Error(msg));
            }
          } catch (e) {
            reject(new Error(`Response parse error: ${e.message}`));
          }
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.write(data);
    req.end();
  });
}

function downloadImage(urlOrB64, filepath, b64Data) {
  return new Promise((resolve, reject) => {
    if (b64Data) {
      fs.writeFile(filepath, Buffer.from(b64Data, 'base64'), (err) => {
        if (err) reject(err);
        else resolve();
      });
      return;
    }

    const transport = urlOrB64.startsWith("https:") ? https : http;
    const file = fs.createWriteStream(filepath);

    transport.get(urlOrB64, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(downloadImage(res.headers.location, filepath));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}
