/**
 * generate-campaign — Runware stills + motion for the Stoppage Time kit.
 *
 *   explore  cheap Grok Imagine stills (direction A/B/C)
 *   lock     GPT Image 2 hero + 3×3 DNA grid + 9:16 reframe from A
 *   motion   Seedance 2 Fast I2V from the locked hero (16:9 and 9:16)
 *
 * Animate last. `motion` refuses to run unless lock/hero.jpg exists.
 *
 * Usage:
 *   npx tsx scripts/generate-campaign.ts explore
 *   npx tsx scripts/generate-campaign.ts lock
 *   npx tsx scripts/generate-campaign.ts motion
 *   npx tsx scripts/generate-campaign.ts round2
 *   npx tsx scripts/generate-campaign.ts mls
 *   npx tsx scripts/generate-campaign.ts mls-lock
 *   npx tsx scripts/generate-campaign.ts mls-cast
 *   npx tsx scripts/generate-campaign.ts brand
 *   npx tsx scripts/generate-campaign.ts flash
 *   npx tsx scripts/generate-campaign.ts mls-motion
 *   npx tsx scripts/generate-campaign.ts title
 *
 * Reads RUNWARE_API_KEY from repo-root or apps/web `.env.local`.
 * Writes to `.runtime/campaign/` (gitignored). includeCost is always on.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const ROOT = process.cwd();
const EXPLORE_DIR = path.join(ROOT, ".runtime/campaign/explore");
const LOCK_DIR = path.join(ROOT, ".runtime/campaign/lock");
const ROUND2_DIR = path.join(ROOT, ".runtime/campaign/round2");
const MLS_DIR = path.join(ROOT, ".runtime/campaign/mls");
const MLS_LOCK_DIR = path.join(ROOT, ".runtime/campaign/mls-lock");
const PASTEUP_REF = path.join(ROUND2_DIR, "1-pasteup-a.jpg");
const TAILGATE_REF = path.join(MLS_DIR, "mls-tailgate.jpg");
const ZINE_REF = path.join(MLS_DIR, "mls-ticket-zine.jpg");
const HERO_STILL = path.join(MLS_LOCK_DIR, "hero.jpg");
const CAST_DIR = path.join(ROOT, ".runtime/campaign/mls-cast");
const MOTION_DIR = path.join(ROOT, ".runtime/campaign/motion");
const MLS_MOTION_DIR = path.join(ROOT, ".runtime/campaign/mls-motion");
const BRAND_DIR = path.join(ROOT, ".runtime/campaign/brand");
const FONTS_DIR = path.join(ROOT, ".runtime/campaign/fonts");
const PUBLIC_CAMPAIGN = path.join(ROOT, "apps/web/public/campaign");
const RUNWARE_URL = "https://api.runware.ai/v1";
const EXPLORE_MODEL = "xai:grok-imagine@image";
const LOCK_MODEL = "openai:gpt-image@2";
const MOTION_MODEL = "bytedance:seedance@2.0-fast";
const WIDTH = 1408;
const HEIGHT = 768;
const PORTRAIT_WIDTH = 768;
const PORTRAIT_HEIGHT = 1408;
const HERO_REF = path.join(EXPLORE_DIR, "a-board-held.jpg");

const SHARED = `
Photorealistic night documentary still, shot on a handheld iPhone, messy
floodlight, humid Florida air, dust visible in the beams. MLS sideline
during extra time. Colour grade: deep navy shadows, a single lime-green
LED glow matching a #00ff88 signal, no other neon. No people faces.
Silhouettes or hands only if needed. No club crests, no FIFA marks, no
broadcast graphics, no captions, no watermarks, no extra text, no logos.
Do not render any readable words. This is a first-frame reference for
image-to-video.`.trim();

type ExploreShot = {
  id: string;
  direction: "A" | "B" | "C";
  title: string;
  prompt: string;
};

const SHOTS: ExploreShot[] = [
  {
    id: "a-board-held",
    direction: "A",
    title: "Board, chest height",
    prompt: `${SHARED}
Subject: a scuffed plastic fourth-official substitution board held at
chest height on the sideline. Lime LED segment bars glow and bleed
slightly into the dark. The digits are abstract unreadable segments,
not forming a score or a word. Wet grass at the bottom edge. Empty
night pitch behind, slightly out of focus.`,
  },
  {
    id: "a-board-ecu",
    direction: "A",
    title: "Board, ECU of LEDs",
    prompt: `${SHARED}
Subject: extreme close-up of a battered fourth-official board. Cracked
plastic, fingerprints, condensed moisture on the LED window. Lime
segment bars glowing, slightly over-bright, unreadable as numbers or
letters. Shallow focus, the night pitch is a dark smear behind.`,
  },
  {
    id: "a-board-wide",
    direction: "A",
    title: "Board, wide sideline",
    prompt: `${SHARED}
Subject: wide sideline view. A fourth-official board stands in the
foreground, lime LEDs the only colour. Empty extra-time, almost no
crowd visible, a few distant floodlights. The board is the object;
the stadium is atmosphere. No readable digits.`,
  },
  {
    id: "a-board-lowered",
    direction: "A",
    title: "Board being lowered",
    prompt: `${SHARED}
Subject: a fourth-official board being lowered toward the grass,
caught mid-motion. Lime LED glow streaks a little. A pair of hands
at the edge of frame, no faces. Wet turf, a scuffed corner flag out
of focus. Unreadable segments only.`,
  },
  {
    id: "b-two-tickets",
    direction: "B",
    title: "Two torn receipts on grass",
    prompt: `${SHARED}
Subject: two torn paper receipts lying on wet night grass at the
sideline. Same size, different paper: one thermal print with a dense
hex-like hash texture, one handwritten carbon copy. No readable
words. A lime LED glow from just out of frame lights the torn edges.
Dual objects, one pitch.`,
  },
  {
    id: "b-tickets-bench",
    direction: "B",
    title: "Two tickets on a bench",
    prompt: `${SHARED}
Subject: a metal substitute bench at night. Two torn tickets sit
side by side on the slats, one slightly overlapping. Thermal vs
handwritten paper. Lime spill from a nearby board off-camera. No
faces, no crests, no readable type.`,
  },
  {
    id: "c-clock-plus",
    direction: "C",
    title: "Stadium clock, extra time",
    prompt: `${SHARED}
Subject: a stadium clock high in the stand, showing extra time as
abstract lime LED bars rather than a readable 90:00. Night, almost
empty bowl, humid haze around the floodlights. The clock is the
object. No sponsor boards with words.`,
  },
  {
    id: "c-watch-glow",
    direction: "C",
    title: "Sideline timer glow",
    prompt: `${SHARED}
Subject: a sideline official's handheld timer, lime digits glowing
in cupped hands. No face. The pitch is a dark wet field behind.
Digits are unreadable segments. Condensation, scuffed plastic,
documentary night.`,
  },
];

type RunwareRow = {
  taskType: string;
  taskUUID: string;
  status?: string;
  progress?: number;
  imageUUID?: string;
  imageURL?: string;
  videoUUID?: string;
  videoURL?: string;
  seed?: number;
  cost?: number;
};

function loadEnv() {
  for (const rel of [".env.local", "apps/web/.env.local"]) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      let value = trimmed.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function authHeaders(): HeadersInit {
  const key = process.env.RUNWARE_API_KEY;
  if (!key) throw new Error("RUNWARE_API_KEY missing from .env.local");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function dataUri(file: string): string {
  const buf = fs.readFileSync(file);
  const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function runTasks(tasks: unknown[]): Promise<RunwareRow[]> {
  const res = await fetch(RUNWARE_URL, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(tasks),
  });
  const body = (await res.json()) as {
    data?: RunwareRow[];
    errors?: { message?: string; taskUUID?: string; code?: string }[];
  };
  if (!res.ok) {
    throw new Error(
      `Runware HTTP ${res.status}: ${JSON.stringify(body).slice(0, 1200)}`
    );
  }
  if (body.errors?.length) {
    throw new Error(`Runware errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data ?? [];
}

async function pollUntilDone(taskUUID: string, label: string): Promise<RunwareRow> {
  const started = Date.now();
  let delay = 4000;
  for (;;) {
    if (Date.now() - started > 8 * 60 * 1000) {
      throw new Error(`timeout waiting for ${label} (${taskUUID})`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 2000, 15000);
    const rows = await runTasks([
      { taskType: "getResponse", taskUUID },
    ]);
    const row = rows.find((r) => r.taskUUID === taskUUID) ?? rows[0];
    if (!row) continue;
    if (row.status === "processing") {
      process.stdout.write(`  ${label} ${row.progress ?? "?"}%\r`);
      continue;
    }
    if (row.videoURL || row.imageURL) {
      process.stdout.write(`  ${label} done                    \n`);
      return row;
    }
    if (row.status === "error") {
      throw new Error(`${label} failed: ${JSON.stringify(row)}`);
    }
  }
}

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function explore() {
  fs.mkdirSync(EXPLORE_DIR, { recursive: true });
  const tasks = SHOTS.map((shot) => ({
    taskType: "imageInference",
    taskUUID: crypto.randomUUID(),
    model: EXPLORE_MODEL,
    positivePrompt: shot.prompt.replace(/\s+/g, " ").trim(),
    width: WIDTH,
    height: HEIGHT,
    outputFormat: "JPG",
    includeCost: true,
    deliveryMethod: "sync",
    _shot: shot,
  }));

  const shotByUuid = new Map(
    tasks.map((t) => [t.taskUUID, t._shot] as const)
  );
  const payload = tasks.map(({ _shot, ...rest }) => rest);

  console.log(`Explore: ${SHOTS.length} stills on ${EXPLORE_MODEL} ${WIDTH}x${HEIGHT}`);
  const results = await runTasks(payload);

  const manifest: {
    generatedAt: string;
    model: string;
    width: number;
    height: number;
    totalCostUsd: number;
    shots: {
      id: string;
      direction: string;
      title: string;
      file: string;
      seed?: number;
      costUsd?: number;
      imageUUID?: string;
    }[];
  } = {
    generatedAt: new Date().toISOString(),
    model: EXPLORE_MODEL,
    width: WIDTH,
    height: HEIGHT,
    totalCostUsd: 0,
    shots: [],
  };

  for (const row of results) {
    const shot = shotByUuid.get(row.taskUUID);
    if (!shot) continue;
    if (!row.imageURL) {
      console.error(`no image for ${shot.id}: ${JSON.stringify(row).slice(0, 400)}`);
      continue;
    }
    const file = `${shot.id}.jpg`;
    await download(row.imageURL, path.join(EXPLORE_DIR, file));
    const cost = row.cost ?? 0;
    manifest.totalCostUsd += cost;
    manifest.shots.push({
      id: shot.id,
      direction: shot.direction,
      title: shot.title,
      file,
      seed: row.seed,
      costUsd: row.cost,
      imageUUID: row.imageUUID,
    });
    console.log(
      `  ${shot.id}  cost=${cost.toFixed(4)}  seed=${row.seed ?? "—"}  → ${file}`
    );
  }

  fs.writeFileSync(
    path.join(EXPLORE_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log(
    `\nWrote ${manifest.shots.length} stills to ${path.relative(ROOT, EXPLORE_DIR)}`
  );
  console.log(`Total explore cost: $${manifest.totalCostUsd.toFixed(4)}`);
}

async function inferImage(opts: {
  prompt: string;
  width: number;
  height: number;
  reference?: string | string[];
  quality: "low" | "medium" | "high";
}): Promise<RunwareRow> {
  const taskUUID = crypto.randomUUID();
  const task: Record<string, unknown> = {
    taskType: "imageInference",
    taskUUID,
    model: LOCK_MODEL,
    positivePrompt: squeeze(opts.prompt),
    width: opts.width,
    height: opts.height,
    outputFormat: "JPG",
    includeCost: true,
    deliveryMethod: "sync",
    providerSettings: { openai: { quality: opts.quality } },
  };
  if (opts.reference) {
    const refs = Array.isArray(opts.reference) ? opts.reference : [opts.reference];
    task.inputs = { referenceImages: refs.map(dataUri) };
  }
  const rows = await runTasks([task]);
  const row = rows[0];
  if (!row?.imageURL) {
    throw new Error(`no image for ${taskUUID}: ${JSON.stringify(rows).slice(0, 800)}`);
  }
  return row;
}

const LOCK_HERO_PROMPT = `
Use Image 1 as the identity and composition reference.

Keep: the same scuffed fourth-official substitution board held at chest
height on a night MLS sideline, the same floodlight haze and wet grass,
the same lime LED glow, and the illegal extra-time reading already on
the board (do not correct it to a real clock). Hands only. No face.

Change only: strip every crest, FIFA mark, sponsor, caption, broadcast
graphic, and extra text from the board and the background. Photorealistic
handheld iPhone night documentary. This is a first-frame reference for
image-to-video.

Constraints: no watermark, no logos, no extra words besides the LED
digits already on the board.
`;

const LOCK_GRID_PROMPT = `
Using Image 1 as the exact object and lighting reference, create a 3x3
storyboard grid, left to right, top to bottom, thin dark gutters.
EVERY panel is the SAME board from Image 1, SAME night, SAME lime LEDs,
SAME illegal extra-time reading.

1 wide sideline  2 medium held board  3 ECU of the LED window
4 board at the corner flag  5 board lowered toward wet grass
6 floodlight flare behind the board
7 wet-grass reflection of the LEDs  8 hands at frame edge holding the board
9 hero beauty close-up of the lime segments

No text labels, no crests, no FIFA marks. Repeat at the end: the SAME
board in every panel. Photorealistic night documentary.
`;

const LOCK_PORTRAIT_PROMPT = `
Use Image 1 as the identity reference. Change only the crop to a tall
9:16 frame. Keep the board as the centered object, same illegal extra-time
reading, same night, same lime LEDs. Hands and board remain. No face.
Strip crests and extra text. Photorealistic handheld iPhone night
documentary. First-frame reference for image-to-video.
`;

async function lock() {
  if (!fs.existsSync(HERO_REF)) {
    throw new Error(`missing ${path.relative(ROOT, HERO_REF)} — run explore first`);
  }
  fs.mkdirSync(LOCK_DIR, { recursive: true });

  console.log(`Lock hero on ${LOCK_MODEL} medium ${WIDTH}x${HEIGHT}`);
  const hero = await inferImage({
    prompt: LOCK_HERO_PROMPT,
    width: WIDTH,
    height: HEIGHT,
    reference: HERO_REF,
    quality: "medium",
  });
  const heroPath = path.join(LOCK_DIR, "hero.jpg");
  await download(hero.imageURL!, heroPath);
  console.log(`  hero  cost=${(hero.cost ?? 0).toFixed(4)}  seed=${hero.seed ?? "—"}`);

  console.log(`Lock grid + 9:16 reframe from hero`);
  const [grid, portrait] = await Promise.all([
    inferImage({
      prompt: LOCK_GRID_PROMPT,
      width: WIDTH,
      height: HEIGHT,
      reference: heroPath,
      quality: "medium",
    }),
    inferImage({
      prompt: LOCK_PORTRAIT_PROMPT,
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      reference: heroPath,
      quality: "medium",
    }),
  ]);
  await download(grid.imageURL!, path.join(LOCK_DIR, "grid.jpg"));
  await download(portrait.imageURL!, path.join(LOCK_DIR, "hero-9x16.jpg"));
  console.log(`  grid     cost=${(grid.cost ?? 0).toFixed(4)}`);
  console.log(`  hero-9x16 cost=${(portrait.cost ?? 0).toFixed(4)}`);

  const total = (hero.cost ?? 0) + (grid.cost ?? 0) + (portrait.cost ?? 0);
  const manifest = {
    generatedAt: new Date().toISOString(),
    model: LOCK_MODEL,
    quality: "medium",
    source: path.relative(ROOT, HERO_REF),
    totalCostUsd: total,
    files: {
      hero: { file: "hero.jpg", seed: hero.seed, costUsd: hero.cost, imageUUID: hero.imageUUID },
      grid: { file: "grid.jpg", seed: grid.seed, costUsd: grid.cost, imageUUID: grid.imageUUID },
      portrait: {
        file: "hero-9x16.jpg",
        seed: portrait.seed,
        costUsd: portrait.cost,
        imageUUID: portrait.imageUUID,
      },
    },
  };
  fs.writeFileSync(path.join(LOCK_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote lock kit to ${path.relative(ROOT, LOCK_DIR)}`);
  console.log(`Total lock cost: $${total.toFixed(4)}`);
}

const MOTION_PROMPT = `
Slow push-in toward the substitution board. Lime LED segments flicker once.
Dust drifts in the floodlight. Keep the board, lighting, and wet pitch
identical. No talking, no camera gear, no drone, no logos, no extra text.
`;

async function motion() {
  const landscape = path.join(LOCK_DIR, "hero.jpg");
  const portrait = path.join(LOCK_DIR, "hero-9x16.jpg");
  if (!fs.existsSync(landscape) || !fs.existsSync(portrait)) {
    throw new Error("missing lock stills — run lock first");
  }
  fs.mkdirSync(MOTION_DIR, { recursive: true });

  const clips = [
    { id: "board-16x9", file: landscape, label: "16:9" },
    { id: "board-9x16", file: portrait, label: "9:16" },
  ];

  console.log(`Motion: Seedance Fast 5s 720p × ${clips.length}`);
  const submitted = await Promise.all(
    clips.map(async (clip) => {
      const taskUUID = crypto.randomUUID();
      await runTasks([
        {
          taskType: "videoInference",
          taskUUID,
          model: MOTION_MODEL,
          positivePrompt: squeeze(MOTION_PROMPT),
          duration: 5,
          resolution: "720p",
          includeCost: true,
          deliveryMethod: "async",
          settings: { audio: true },
          inputs: {
            frameImages: [{ image: dataUri(clip.file), frame: "first" }],
          },
        },
      ]);
      return { ...clip, taskUUID };
    })
  );

  const results = [];
  let total = 0;
  for (const clip of submitted) {
    const row = await pollUntilDone(clip.taskUUID, clip.label);
    if (!row.videoURL) throw new Error(`no video for ${clip.id}`);
    const dest = path.join(MOTION_DIR, `${clip.id}.mp4`);
    await download(row.videoURL, dest);
    total += row.cost ?? 0;
    results.push({
      id: clip.id,
      file: `${clip.id}.mp4`,
      costUsd: row.cost,
      seed: row.seed,
      videoUUID: row.videoUUID,
    });
    console.log(`  ${clip.id}  cost=${(row.cost ?? 0).toFixed(4)}`);
  }

  fs.writeFileSync(
    path.join(MOTION_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: MOTION_MODEL,
        duration: 5,
        resolution: "720p",
        totalCostUsd: total,
        clips: results,
      },
      null,
      2
    )
  );
  console.log(`\nWrote motion to ${path.relative(ROOT, MOTION_DIR)}`);
  console.log(`Total motion cost: $${total.toFixed(4)}`);
}

const GESTURE = `
A night MLS / football match. A fourth official in a black kit stands
on the sideline, facing the camera, holding a scuffed substitution board
HIGH ABOVE THEIR HEAD with both arms extended — the classic added-time
gesture. The official is visible and human, not a silhouette and not
horror lighting. Behind them: a packed crowd in the stands, floodlights,
colour in the scarves and seats, wet grass, a corner flag. Energetic
match night, not empty, not macabre, not mist-as-mood.
The board's LED face clearly shows "+4" in lime-green seven-segment
digits — the plus sign and the 4 must be readable. No other numbers.
No FIFA marks, no club crests, no broadcast graphics, no watermarks.
`.trim();

const ROUND2_SHOTS: { id: string; direction: "1" | "2" | "3"; title: string; prompt: string }[] = [
  {
    id: "1-pasteup-a",
    direction: "1",
    title: "Paste-up, grid over stands",
    prompt: `${GESTURE}
ARTISTIC TWIST — editorial collage / paste-up, not a straight photo:
an 8x8 faint signal grid over the crowd like a UI overlay; a lime
rectangular YES cell and a bone-cream NO cell stuck on the grass like
stickers; a small lime live-dot on the corner of the board; torn
receipt-paper strips with dashed lines. Palette: navy #0c1428 night,
lime #00ff88 LEDs, bone and slate. Poster, graphic, a bit playful.
The only readable type on the board is "+4". No other words in the image.`,
  },
  {
    id: "1-pasteup-b",
    direction: "1",
    title: "Paste-up, receipt collision",
    prompt: `${GESTURE}
ARTISTIC TWIST — cut-and-paste sports poster: the crowd is photographic,
the foreground has collaged UI scraps from a dark prediction-market
instrument (navy panels, lime live-dot, a YES block in lime, a NO block
in bone, hairline rules). The board stays photographic with "+4" in lime.
Slightly joyful, Saturday-night, not grim. No extra captions.`,
  },
  {
    id: "2-gesture-a",
    direction: "2",
    title: "Clean gesture, crowd",
    prompt: `${GESTURE}
STRAIGHT documentary photograph. No collage, no UI stickers, no extra
graphic overlays. Photorealistic handheld sports photo, packed stands,
board "+4" overhead. Leave negative space in the sky / upper third for
a headline to be added later. No words anywhere except the "+4" on the board.`,
  },
  {
    id: "2-gesture-b",
    direction: "2",
    title: "Clean gesture, low angle",
    prompt: `${GESTURE}
STRAIGHT documentary photograph, slightly low angle so the board "+4"
sits in the upper third against floodlights and crowd. Official's face
readable, kit black. No collage, no UI, no extra text. Leave room for
a serif headline. Photorealistic match-night photo.`,
  },
  {
    id: "3-matchboard-a",
    direction: "3",
    title: "Board is the match board",
    prompt: `${GESTURE}
TWIST: the physical board's LED face is replaced by a miniature of a
dark match-instrument UI: an 8x8 signal grid, a lime scoreline, tiny
YES/NO cells, DM-mono style ticks. The object is still a handheld
substitution board held overhead. Crowd and pitch stay photographic.
The lime on the face includes a clear "+4". No FIFA, no extra slogans.`,
  },
  {
    id: "3-matchboard-b",
    direction: "3",
    title: "Board is the scoreline",
    prompt: `${GESTURE}
TWIST: looking at the raised board you see the app's scoreboard — two
team names as bars, a lime live-dot, a 8-column signal grid behind the
digits, "+4" large in lime seven-segment. Crowd packed behind the
official. Graphic face on a real board, photographic world. No other
words, no crests.`,
  },
];

async function round2() {
  fs.mkdirSync(ROUND2_DIR, { recursive: true });
  console.log(`Round 2: ${ROUND2_SHOTS.length} stills on ${LOCK_MODEL} medium ${WIDTH}x${HEIGHT}`);

  const results: {
    id: string;
    direction: string;
    title: string;
    file: string;
    costUsd?: number;
    imageUUID?: string;
  }[] = [];
  let total = 0;

  // Two at a time — GPT Image 2 sync is slow; avoid a six-way pileup.
  for (let i = 0; i < ROUND2_SHOTS.length; i += 2) {
    const batch = ROUND2_SHOTS.slice(i, i + 2);
    const rows = await Promise.all(
      batch.map((shot) =>
        inferImage({
          prompt: shot.prompt,
          width: WIDTH,
          height: HEIGHT,
          quality: "medium",
        }).then((row) => ({ shot, row }))
      )
    );
    for (const { shot, row } of rows) {
      const file = `${shot.id}.jpg`;
      await download(row.imageURL!, path.join(ROUND2_DIR, file));
      const cost = row.cost ?? 0;
      total += cost;
      results.push({
        id: shot.id,
        direction: shot.direction,
        title: shot.title,
        file,
        costUsd: row.cost,
        imageUUID: row.imageUUID,
      });
      console.log(`  ${shot.id}  cost=${cost.toFixed(4)}  → ${file}`);
    }
  }

  fs.writeFileSync(
    path.join(ROUND2_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: LOCK_MODEL,
        quality: "medium",
        totalCostUsd: total,
        shots: results,
      },
      null,
      2
    )
  );
  console.log(`\nWrote round 2 to ${path.relative(ROOT, ROUND2_DIR)}`);
  console.log(`Total round 2 cost: $${total.toFixed(4)}`);
}

const PASTEUP_LOCK = `
Use Image 1 as the COLLAGE LANGUAGE reference — keep that exact graphic
system: torn navy paper frames with white ragged edges, tan masking tape,
faint 8x8 signal grid over the photo, lime rectangular sticker with a
hand-drawn check, bone-cream sticker with a bold X, dashed receipt-paper
strips, yellow crop-mark corners, navy #0c1428 underlayer, lime #00ff88
LEDs. Do not copy Image 1's person, stadium, or crowd. Rebuild the scene.

Keep the readable stoppage-time gesture: a fourth official on the
sideline holding a substitution board HIGH ABOVE THEIR HEAD with both
arms. The board shows "+4" in lime seven-segment LEDs and nothing else.
A small lime live-dot sits on the board corner.

Tone: lively American Saturday night, memetic, a bit funny — not grim,
not empty, not horror mist. Packed MLS crowd. No FIFA marks, no club
crests, no Nike swooshes, no dollar amounts, no fake stats, no extra
slogans besides "+4" on the board. No readable STOPPAGE type.
`.trim();

const MLS_SHOTS: { id: string; title: string; prompt: string }[] = [
  {
    id: "mls-tailgate",
    title: "Tailgate collision",
    prompt: `${PASTEUP_LOCK}
AMERICAN MLS TWIST: the paste-up collides a night pitch with a parking-
lot tailgate. Grill smoke, a red plastic cup, string lights, a handmade
cardboard sign with messy hand lettering (no brand, no readable slogan
longer than a word), a torn generic ticket stub showing only a section
number. Crowd colour is purple vs orange (no crests). The official and
the +4 board stay the hero. Overlapping scraps, tape, grid.`,
  },
  {
    id: "mls-jumbotron",
    title: "Jumbotron scanlines",
    prompt: `${PASTEUP_LOCK}
AMERICAN MLS TWIST: a stadium jumbotron bleeds into the collage —
CRT scanlines, a giant "+4" echo on the video board behind the official,
summer fireworks far off, foam-finger silhouettes in the crowd, a torn
nacho-tray scrap as paper. Friday-Night-Lights colliding with soccer.
Broadcast-night energy. Board overhead still reads "+4".`,
  },
  {
    id: "mls-ticket-zine",
    title: "Zine / ticket stub",
    prompt: `${PASTEUP_LOCK}
AMERICAN MLS TWIST: sports-zine / mixtape-cover energy. Layer torn
ticket stubs, a parking pass, a paper wristband, a mustard stain on a
napkin scrap, a DIY scarf with no logos. American summer-soccer colour
— sunset orange, purple, lime. Official holds "+4" overhead. More
paper, more collage, more memetic, still one clear gesture.`,
  },
  {
    id: "mls-drumline",
    title: "Supporters + drumline",
    prompt: `${PASTEUP_LOCK}
AMERICAN MLS TWIST: behind the official, a supporters' section with
drumline / marching-band energy (snare, bass drum — no school or club
names on the drums), orange and purple smoke, handmade banners with
no readable words. Lime YES cell and bone NO cell as stickers on the
grass. Board "+4" overhead. Joyful American soccer noise, not a thriller.`,
  },
];

async function mls() {
  if (!fs.existsSync(PASTEUP_REF)) {
    throw new Error(`missing ${path.relative(ROOT, PASTEUP_REF)} — run round2 first`);
  }
  fs.mkdirSync(MLS_DIR, { recursive: true });
  console.log(`MLS paste-up: ${MLS_SHOTS.length} stills from 1-pasteup-a`);

  const results: { id: string; title: string; file: string; costUsd?: number }[] = [];
  let total = 0;

  for (let i = 0; i < MLS_SHOTS.length; i += 2) {
    const batch = MLS_SHOTS.slice(i, i + 2);
    const rows = await Promise.all(
      batch.map((shot) =>
        inferImage({
          prompt: shot.prompt,
          width: WIDTH,
          height: HEIGHT,
          reference: PASTEUP_REF,
          quality: "medium",
        }).then((row) => ({ shot, row }))
      )
    );
    for (const { shot, row } of rows) {
      const file = `${shot.id}.jpg`;
      await download(row.imageURL!, path.join(MLS_DIR, file));
      const cost = row.cost ?? 0;
      total += cost;
      results.push({ id: shot.id, title: shot.title, file, costUsd: row.cost });
      console.log(`  ${shot.id}  cost=${cost.toFixed(4)}  → ${file}`);
    }
  }

  fs.writeFileSync(
    path.join(MLS_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "1-pasteup-a.jpg",
        model: LOCK_MODEL,
        quality: "medium",
        totalCostUsd: total,
        shots: results,
      },
      null,
      2
    )
  );
  console.log(`\nWrote MLS kit to ${path.relative(ROOT, MLS_DIR)}`);
  console.log(`Total MLS cost: $${total.toFixed(4)}`);
}

const TAILGATE_LOCK = `
Use Image 1 as the SCENE identity: American MLS Saturday tailgate
colliding with a night pitch. Fourth official holds a substitution
board HIGH ABOVE THEIR HEAD. The board shows "+4" in lime seven-segment
LEDs, lime live-dot on the corner, nothing else on the board. Packed
crowd in purple vs orange (no crests). Grill smoke, red plastic cup,
string lights, torn navy paper frames, tan masking tape, faint 8x8
signal grid, lime check sticker, bone X sticker, navy #0c1428 underlayer.

Use Image 2 only for PAPER LANGUAGE: ticket stubs, a parking scrap, a
paper wristband, a coffee or mustard stain, denser collage. Do not copy
Image 2's sunset, person, or composition.

Ban: the word WIN, the word PARKING as big type, STOPPAGE, dollar
amounts, fake stats, FIFA marks, club crests, Nike swooshes. Ticket
stubs may show a section number only. The only LED type is "+4".
Leave negative space in the sky / upper third for a serif headline.
Tone: lively, memetic, American Saturday night — not grim.
`.trim();

const MLS_LOCK_SHOTS: {
  id: string;
  title: string;
  width: number;
  height: number;
  prompt: string;
}[] = [
  {
    id: "hero",
    title: "Tailgate hero 16:9",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${TAILGATE_LOCK}
THIS FRAME: the clean hero. Official centered, board "+4" readable,
tailgate readable left and right (grill, cup, purple/orange). Collage
on the edges, not over the face or the board. Sky open for type.`,
  },
  {
    id: "paper",
    title: "Tailgate + zine paper",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${TAILGATE_LOCK}
THIS FRAME: same tailgate scene, denser paper — torn ticket, parking
scrap with no big word, orange wristband, mustard stain on a napkin,
DIY scarf with no logos. Gesture still clear. Collage more memetic.`,
  },
  {
    id: "portrait",
    title: "Tailgate 9:16",
    width: PORTRAIT_WIDTH,
    height: PORTRAIT_HEIGHT,
    prompt: `${TAILGATE_LOCK}
THIS FRAME: tall 9:16 crop of the same collision. Official and "+4"
board in the upper-middle third. Tailgate (grill, cup, purple/orange)
fills the lower third. Collage on the paper edges. Open sky at the
top for a stacked serif headline. Not a cropped 16:9 — compose tall.`,
  },
  {
    id: "nacho",
    title: "Tailgate + stadium scrap",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${TAILGATE_LOCK}
THIS FRAME: same tailgate hero, one extra American joke — a torn
nacho-tray scrap in a corner, distant fireworks or a jumbotron glow
behind the crowd (not the subject). Foam-finger silhouette ok. Keep
the official and "+4" as the hero. Do not turn this into a fireworks ad.`,
  },
];

async function mlsLock() {
  for (const file of [TAILGATE_REF, ZINE_REF]) {
    if (!fs.existsSync(file)) {
      throw new Error(`missing ${path.relative(ROOT, file)} — run mls first`);
    }
  }
  fs.mkdirSync(MLS_LOCK_DIR, { recursive: true });
  console.log(`MLS lock: ${MLS_LOCK_SHOTS.length} stills from tailgate + ticket-zine`);

  const results: { id: string; title: string; file: string; costUsd?: number }[] = [];
  let total = 0;
  const refs = [TAILGATE_REF, ZINE_REF];

  for (let i = 0; i < MLS_LOCK_SHOTS.length; i += 2) {
    const batch = MLS_LOCK_SHOTS.slice(i, i + 2);
    const rows = await Promise.all(
      batch.map((shot) =>
        inferImage({
          prompt: shot.prompt,
          width: shot.width,
          height: shot.height,
          reference: refs,
          quality: "medium",
        }).then((row) => ({ shot, row }))
      )
    );
    for (const { shot, row } of rows) {
      const file = `${shot.id}.jpg`;
      await download(row.imageURL!, path.join(MLS_LOCK_DIR, file));
      const cost = row.cost ?? 0;
      total += cost;
      results.push({ id: shot.id, title: shot.title, file, costUsd: row.cost });
      console.log(`  ${shot.id}  cost=${cost.toFixed(4)}  → ${file}`);
    }
  }

  fs.writeFileSync(
    path.join(MLS_LOCK_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: ["mls-tailgate.jpg", "mls-ticket-zine.jpg"],
        model: LOCK_MODEL,
        quality: "medium",
        totalCostUsd: total,
        shots: results,
      },
      null,
      2
    )
  );
  console.log(`\nWrote MLS lock to ${path.relative(ROOT, MLS_LOCK_DIR)}`);
  console.log(`Total MLS lock cost: $${total.toFixed(4)}`);
}

const CAST_LOCK = `
Use Image 1 for COLLAGE LANGUAGE and colour only: torn navy paper
frames, tan masking tape, 8x8 signal grid, lime check sticker, bone X
sticker, dashed ticket scraps, navy #0c1428, lime #00ff88, purple vs
orange crowd colour. Do NOT copy Image 1's official, face, body, age,
or gender. Cast a new fourth official for this frame.

Every frame: official in a black kit holds a substitution board HIGH
ABOVE THEIR HEAD. Board shows "+4" in lime seven-segment LEDs and
nothing else. Lime live-dot on the board corner. Packed, lively
American Saturday night — not grim. No FIFA, no club crests, no Nike,
no dollar amounts, no STOPPAGE type, no WIN, no PARKING as big type.
Ticket stubs may show a section number only. Leave sky for a headline.
`.trim();

const CAST_SHOTS: {
  id: string;
  title: string;
  width: number;
  height: number;
  prompt: string;
}[] = [
  {
    id: "sideline",
    title: "Pitch sideline",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${CAST_LOCK}
CAST: a Black woman official, early 30s, short natural hair, black kit.
ROOM: classic MLS sideline — wet grass, corner flag, packed stands in
purple and orange, floodlights. Paste-up collage on the edges. This is
the pitch beat in the flash cut.`,
  },
  {
    id: "tailgate-2",
    title: "Tailgate, new official",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${CAST_LOCK}
CAST: a Latino man official, early 50s, grey at the temples, black kit.
ROOM: parking-lot tailgate — grill smoke, red plastic cups, string
lights, purple tent vs orange crowd. Same collision as the hero, new
face. Collage on the edges.`,
  },
  {
    id: "jumbo",
    title: "Jumbotron concourse",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${CAST_LOCK}
CAST: an East Asian woman official, mid 20s, black kit, hair in a bun.
ROOM: American stadium concourse / jumbotron glow behind her, foam-
finger silhouettes, a torn nacho scrap in a corner, distant fireworks
as atmosphere not the subject. Board "+4" is the hero.`,
  },
  {
    id: "supporters",
    title: "Supporters' section",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${CAST_LOCK}
CAST: a South Asian woman official, early 40s, black kit.
ROOM: right in front of a supporters' section — purple and orange
smoke, a bass drum, handmade banners with no readable words, scarves.
American drumline energy, not European ultras grimness. Collage edges.`,
  },
  {
    id: "backyard",
    title: "Watch-party backyard",
    width: WIDTH,
    height: HEIGHT,
    prompt: `${CAST_LOCK}
CAST: a young Black man official, mid 20s, black kit.
ROOM: American backyard watch party — string lights, folding chairs,
a TV glow, a grill, red cups, friends in purple and orange. The
official standing in the yard with the "+4" board is the surreal
insert. Memetic, funny, still the same collage chrome.`,
  },
  {
    id: "sideline-portrait",
    title: "Sideline 9:16",
    width: PORTRAIT_WIDTH,
    height: PORTRAIT_HEIGHT,
    prompt: `${CAST_LOCK}
CAST: a white woman official, late 30s, visor, black kit.
ROOM: tall 9:16 sideline — official and "+4" in the upper-middle,
packed purple/orange stands behind, collage on paper edges, open sky
at the top for a stacked headline. Compose tall, do not crop a 16:9.`,
  },
];

async function mlsCast() {
  if (!fs.existsSync(HERO_STILL)) {
    throw new Error(`missing ${path.relative(ROOT, HERO_STILL)} — run mls-lock first`);
  }
  fs.mkdirSync(CAST_DIR, { recursive: true });
  console.log(`MLS cast: ${CAST_SHOTS.length} stills from hero chrome`);

  const results: { id: string; title: string; file: string; costUsd?: number }[] = [];
  let total = 0;

  for (let i = 0; i < CAST_SHOTS.length; i += 2) {
    const batch = CAST_SHOTS.slice(i, i + 2);
    const rows = await Promise.all(
      batch.map((shot) =>
        inferImage({
          prompt: shot.prompt,
          width: shot.width,
          height: shot.height,
          reference: HERO_STILL,
          quality: "medium",
        }).then((row) => ({ shot, row }))
      )
    );
    for (const { shot, row } of rows) {
      const file = `${shot.id}.jpg`;
      await download(row.imageURL!, path.join(CAST_DIR, file));
      const cost = row.cost ?? 0;
      total += cost;
      results.push({ id: shot.id, title: shot.title, file, costUsd: row.cost });
      console.log(`  ${shot.id}  cost=${cost.toFixed(4)}  → ${file}`);
    }
  }

  fs.writeFileSync(
    path.join(CAST_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "mls-lock/hero.jpg",
        model: LOCK_MODEL,
        quality: "medium",
        totalCostUsd: total,
        shots: results,
      },
      null,
      2
    )
  );
  console.log(`\nWrote MLS cast to ${path.relative(ROOT, CAST_DIR)}`);
  console.log(`Total MLS cast cost: $${total.toFixed(4)}`);
}

const SERIF_FONT_URL =
  "https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf";
const MONO_FONT_URL =
  "https://github.com/google/fonts/raw/main/ofl/dmmono/DMMono-Medium.ttf";

async function ensureFonts() {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  const serif = path.join(FONTS_DIR, "InstrumentSerif-Regular.ttf");
  const mono = path.join(FONTS_DIR, "DMMono-Medium.ttf");
  if (!fs.existsSync(serif)) {
    console.log("Downloading Instrument Serif…");
    await download(SERIF_FONT_URL, serif);
  }
  if (!fs.existsSync(mono)) {
    console.log("Downloading DM Mono…");
    await download(MONO_FONT_URL, mono);
  }
  return { serif, mono };
}

function identify(file: string): { w: number; h: number } {
  const out = execFileSync("magick", ["identify", "-format", "%w %h", file], {
    encoding: "utf8",
  });
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w, h };
}

function brandStill(opts: {
  input: string;
  output: string;
  serif: string;
  mono: string;
  mode: "landscape" | "portrait" | "og";
}) {
  const { w, h } = identify(opts.input);
  const topH = opts.mode === "portrait" ? Math.round(h * 0.11) : Math.round(h * 0.16);
  const botH = opts.mode === "portrait" ? Math.round(h * 0.16) : Math.round(h * 0.22);
  const pad = opts.mode === "portrait" ? 48 : 52;
  const titleSize =
    opts.mode === "portrait" ? 72 : opts.mode === "og" ? 54 : 62;
  const metaSize = opts.mode === "portrait" ? 22 : 20;
  const urlSize = opts.mode === "portrait" ? 18 : 16;

  execFileSync("magick", [
    opts.input,
    "-fill",
    "rgba(12,20,40,0.58)",
    "-draw",
    `rectangle 0,0 ${w},${topH}`,
    "-fill",
    "rgba(12,20,40,0.66)",
    "-draw",
    `rectangle 0,${h - botH} ${w},${h}`,
    "-font",
    opts.mono,
    "-fill",
    "#00ff88",
    "-pointsize",
    String(metaSize),
    "-gravity",
    "northwest",
    "-annotate",
    `+${pad}+${Math.round(pad * 0.7)}`,
    "MLS  ·  SAT 15 AUG  ·  +4",
    "-font",
    opts.serif,
    "-fill",
    "#e2e8f0",
    "-pointsize",
    String(titleSize),
    "-gravity",
    "southwest",
    "-annotate",
    `+${pad}+${Math.round(pad * 1.35)}`,
    "Stoppage Time",
    "-font",
    opts.mono,
    "-fill",
    "#cad5e8",
    "-pointsize",
    String(urlSize),
    "-gravity",
    "southwest",
    "-annotate",
    `+${pad}+${Math.round(pad * 0.45)}`,
    "ORLANDO CITY  V  FC CINCINNATI",
    "-font",
    opts.mono,
    "-fill",
    "#00ff88",
    "-pointsize",
    String(urlSize),
    "-gravity",
    "southeast",
    "-annotate",
    `+${pad}+${Math.round(pad * 0.45)}`,
    "stoppage.sportwarren.com",
    "-quality",
    "92",
    opts.output,
  ]);
}

async function brand() {
  const { serif, mono } = await ensureFonts();
  fs.mkdirSync(BRAND_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_CAMPAIGN, { recursive: true });

  const plates: { id: string; src: string; mode: "landscape" | "portrait" }[] = [
    { id: "hero", src: path.join(MLS_LOCK_DIR, "hero.jpg"), mode: "landscape" },
    { id: "portrait", src: path.join(MLS_LOCK_DIR, "portrait.jpg"), mode: "portrait" },
    { id: "paper", src: path.join(MLS_LOCK_DIR, "paper.jpg"), mode: "landscape" },
    { id: "sideline", src: path.join(CAST_DIR, "sideline.jpg"), mode: "landscape" },
    { id: "jumbo", src: path.join(CAST_DIR, "jumbo.jpg"), mode: "landscape" },
    { id: "backyard", src: path.join(CAST_DIR, "backyard.jpg"), mode: "landscape" },
    { id: "supporters", src: path.join(CAST_DIR, "supporters.jpg"), mode: "landscape" },
    {
      id: "sideline-portrait",
      src: path.join(CAST_DIR, "sideline-portrait.jpg"),
      mode: "portrait",
    },
  ];

  for (const plate of plates) {
    if (!fs.existsSync(plate.src)) {
      console.warn(`skip ${plate.id} — missing ${path.relative(ROOT, plate.src)}`);
      continue;
    }
    const dest = path.join(BRAND_DIR, `${plate.id}.jpg`);
    brandStill({ input: plate.src, output: dest, serif, mono, mode: plate.mode });
    console.log(`  branded ${plate.id}`);
  }

  const heroSrc = path.join(MLS_LOCK_DIR, "hero.jpg");
  if (fs.existsSync(heroSrc)) {
    const ogWork = path.join(BRAND_DIR, "_og-crop.jpg");
    execFileSync("magick", [
      heroSrc,
      "-gravity",
      "center",
      "-crop",
      "1200x630+0+0",
      "+repage",
      ogWork,
    ]);
    brandStill({
      input: ogWork,
      output: path.join(BRAND_DIR, "og.jpg"),
      serif,
      mono,
      mode: "og",
    });
    fs.unlinkSync(ogWork);
    console.log("  branded og");
  }

  const publish = [
    ["hero.jpg", path.join(MLS_LOCK_DIR, "hero.jpg")],
    ["portrait.jpg", path.join(MLS_LOCK_DIR, "portrait.jpg")],
    ["hero-branded.jpg", path.join(BRAND_DIR, "hero.jpg")],
    ["portrait-branded.jpg", path.join(BRAND_DIR, "portrait.jpg")],
    ["og.jpg", path.join(BRAND_DIR, "og.jpg")],
    ["sideline-branded.jpg", path.join(BRAND_DIR, "sideline.jpg")],
    ["backyard-branded.jpg", path.join(BRAND_DIR, "backyard.jpg")],
  ] as const;
  for (const [name, src] of publish) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PUBLIC_CAMPAIGN, name));
  }

  const downloads = path.join(process.env.HOME ?? "", "Downloads/stoppage-time-socials");
  fs.mkdirSync(downloads, { recursive: true });
  for (const file of fs.readdirSync(BRAND_DIR).filter((f) => f.endsWith(".jpg"))) {
    fs.copyFileSync(path.join(BRAND_DIR, file), path.join(downloads, file));
  }
  console.log(`\nSocial kit → ${downloads}`);
  console.log(`App copies → ${path.relative(ROOT, PUBLIC_CAMPAIGN)}`);
}

function flash() {
  const landscape = ["hero", "sideline", "jumbo", "backyard", "supporters", "paper"]
    .map((id) => path.join(BRAND_DIR, `${id}.jpg`))
    .filter((f) => fs.existsSync(f));
  if (landscape.length < 2) throw new Error("run brand first");

  fs.mkdirSync(MLS_MOTION_DIR, { recursive: true });
  const list = path.join(MLS_MOTION_DIR, "flash-list.txt");
  const lines: string[] = [];
  for (const file of landscape) {
    lines.push(`file '${file.replace(/'/g, "'\\''")}'`);
    lines.push("duration 0.38");
  }
  lines.push(`file '${landscape[landscape.length - 1].replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(list, lines.join("\n"));

  const dest = path.join(MLS_MOTION_DIR, "flash-16x9.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    "scale=1408:768:force_original_aspect_ratio=decrease,pad=1408:768:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
    "-movflags",
    "+faststart",
    dest,
  ], { stdio: "inherit" });

  const downloads = path.join(process.env.HOME ?? "", "Downloads/stoppage-time-socials");
  fs.mkdirSync(downloads, { recursive: true });
  fs.copyFileSync(dest, path.join(downloads, "flash-16x9.mp4"));
  console.log(`\nFlash cut → ${dest}`);
}

const MLS_MOTION_PROMPT = `
The photographic center of this collage lives: packed crowd sways, string
lights flicker, grill or stadium smoke drifts, the fourth official holds
the substitution board steady overhead with "+4" lime LEDs. The torn navy
paper, masking tape, 8x8 grid, lime check sticker and bone X stay locked
as a graphic frame — they do not peel, warp, or fly. Slow breathing push,
not a thriller. No extra text, no logos, no FIFA, no camera gear.
`.trim();

async function mlsMotion() {
  const landscape = path.join(MLS_LOCK_DIR, "hero.jpg");
  const portrait = path.join(MLS_LOCK_DIR, "portrait.jpg");
  if (!fs.existsSync(landscape) || !fs.existsSync(portrait)) {
    throw new Error("missing mls-lock stills — run mls-lock first");
  }
  fs.mkdirSync(MLS_MOTION_DIR, { recursive: true });

  const clips = [
    { id: "hero-16x9", file: landscape, label: "16:9 hero" },
    { id: "hero-9x16", file: portrait, label: "9:16 portrait" },
  ];

  console.log(`MLS motion: Seedance Fast 5s 720p × ${clips.length}`);
  const submitted = await Promise.all(
    clips.map(async (clip) => {
      const taskUUID = crypto.randomUUID();
      await runTasks([
        {
          taskType: "videoInference",
          taskUUID,
          model: MOTION_MODEL,
          positivePrompt: squeeze(MLS_MOTION_PROMPT),
          duration: 5,
          resolution: "720p",
          includeCost: true,
          deliveryMethod: "async",
          settings: { audio: true },
          inputs: {
            frameImages: [{ image: dataUri(clip.file), frame: "first" }],
          },
        },
      ]);
      return { ...clip, taskUUID };
    })
  );

  const results = [];
  let total = 0;
  for (const clip of submitted) {
    const row = await pollUntilDone(clip.taskUUID, clip.label);
    if (!row.videoURL) throw new Error(`no video for ${clip.id}`);
    const dest = path.join(MLS_MOTION_DIR, `${clip.id}.mp4`);
    await download(row.videoURL, dest);
    total += row.cost ?? 0;
    results.push({
      id: clip.id,
      file: `${clip.id}.mp4`,
      costUsd: row.cost,
      seed: row.seed,
      videoUUID: row.videoUUID,
    });
    console.log(`  ${clip.id}  cost=${(row.cost ?? 0).toFixed(4)}`);
  }

  fs.writeFileSync(
    path.join(MLS_MOTION_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: MOTION_MODEL,
        duration: 5,
        resolution: "720p",
        totalCostUsd: total,
        clips: results,
      },
      null,
      2
    )
  );
  const downloads = path.join(process.env.HOME ?? "", "Downloads/stoppage-time-socials");
  fs.mkdirSync(downloads, { recursive: true });
  for (const clip of results) {
    fs.copyFileSync(
      path.join(MLS_MOTION_DIR, clip.file),
      path.join(downloads, clip.file)
    );
  }
  console.log(`\nWrote MLS motion to ${path.relative(ROOT, MLS_MOTION_DIR)}`);
  console.log(`Total MLS motion cost: $${total.toFixed(4)}`);
}

async function title() {
  const { serif, mono } = await ensureFonts();
  const downloads = path.join(process.env.HOME ?? "", "Downloads/stoppage-time-socials");
  const overlayDir = path.join(MLS_MOTION_DIR, "overlays");
  fs.mkdirSync(overlayDir, { recursive: true });

  const portraitIn = path.join(MLS_MOTION_DIR, "hero-9x16.mp4");
  const landscapeIn = path.join(MLS_MOTION_DIR, "hero-16x9.mp4");
  if (!fs.existsSync(portraitIn) || !fs.existsSync(landscapeIn)) {
    throw new Error("missing Seedance clips — run mls-motion first");
  }

  const ov9 = path.join(overlayDir, "title-9x16.png");
  const ov16 = path.join(overlayDir, "title-16x9.png");

  execFileSync("magick", [
    "-size", "720x1280", "xc:none",
    "-font", serif, "-fill", "#e2e8f0", "-pointsize", "78",
    "-gravity", "north", "-annotate", "+0+86", "Stoppage",
    "-font", mono, "-fill", "#00ff88", "-pointsize", "18",
    "-gravity", "north", "-annotate", "+0+178", "MLS  ·  SAT 15 AUG",
    ov9,
  ]);

  execFileSync("magick", [
    "-size", "1280x720", "xc:none",
    "-font", serif, "-fill", "#e2e8f0", "-pointsize", "48",
    "-gravity", "southwest", "-annotate", "+48+56", "Stoppage Time",
    "-font", mono, "-fill", "#00ff88", "-pointsize", "16",
    "-gravity", "southeast", "-annotate", "+48+28", "stoppage.sportwarren.com",
    ov16,
  ]);

  function stamp(input: string, overlay: string, output: string) {
    execFileSync("ffmpeg", [
      "-y",
      "-i", input,
      "-loop", "1",
      "-i", overlay,
      "-filter_complex",
      "[1:v]format=rgba,fade=t=in:st=0.4:d=0.7:alpha=1[ov];[0:v][ov]overlay=0:0:format=auto",
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "fast",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-shortest",
      output,
    ], { stdio: "inherit" });
  }

  const out9 = path.join(MLS_MOTION_DIR, "hero-9x16-titled.mp4");
  const out16 = path.join(MLS_MOTION_DIR, "hero-16x9-titled.mp4");
  stamp(portraitIn, ov9, out9);
  stamp(landscapeIn, ov16, out16);

  fs.mkdirSync(downloads, { recursive: true });
  fs.copyFileSync(out9, path.join(downloads, "hero-9x16-titled.mp4"));
  fs.copyFileSync(out16, path.join(downloads, "hero-16x9-titled.mp4"));
  console.log(`\nTitled clips → ${downloads}`);
}

async function main() {
  loadEnv();
  const cmd = process.argv[2] ?? "explore";
  if (cmd === "explore") await explore();
  else if (cmd === "lock") await lock();
  else if (cmd === "motion") await motion();
  else if (cmd === "round2") await round2();
  else if (cmd === "mls") await mls();
  else if (cmd === "mls-lock") await mlsLock();
  else if (cmd === "mls-cast") await mlsCast();
  else if (cmd === "brand") await brand();
  else if (cmd === "flash") flash();
  else if (cmd === "mls-motion") await mlsMotion();
  else if (cmd === "title") await title();
  else {
    console.error(
      "Usage: npx tsx scripts/generate-campaign.ts [explore|lock|motion|round2|mls|mls-lock|mls-cast|brand|flash|mls-motion|title]"
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
