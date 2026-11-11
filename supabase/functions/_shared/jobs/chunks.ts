// Job text for embedding: a header with the main fields, then the description in pieces.
// Shared by scripts/embed-jobs.ts and its tests; contact and poster data (raw) never go in.
export type ChunkSource = {
  title: string;
  company_name: string | null;
  location: string | null;
  salary: string | null;
  employment_type: string | null;
  description_text: string | null;
};

// Characters, not tokens: ~1,500 Vietnamese characters stay far under the model's 8,000-token context.
export const CHUNK_CHARS = 1_500;
export const MAX_CHUNKS = 4;

export function header(job: ChunkSource): string {
  return [
    job.title,
    job.company_name && `Công ty: ${job.company_name}`,
    job.location && `Địa điểm: ${job.location}`,
    job.salary && `Lương: ${job.salary}`,
    job.employment_type && `Loại hình: ${job.employment_type}`,
  ].filter(Boolean).join("\n");
}

// Every chunk repeats the header so each one matches on title and location. Pieces end at whitespace.
export function chunks(job: ChunkSource): string[] {
  const head = header(job);
  const body = (job.description_text ?? "").replace(/\s+/g, " ").trim();
  if (!body) return [head];
  const out: string[] = [];
  let rest = body;
  while (rest && out.length < MAX_CHUNKS) {
    let piece = rest.slice(0, CHUNK_CHARS);
    if (rest.length > CHUNK_CHARS) {
      const cut = piece.lastIndexOf(" ");
      if (cut > CHUNK_CHARS / 2) piece = piece.slice(0, cut);
    }
    out.push(`${head}\n\n${piece.trim()}`);
    rest = rest.slice(piece.length).trim();
  }
  return out;
}

// Hex sha-256 of model and text: a new model or changed text means a new vector.
export async function contentHash(model: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${model}\n${text}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
