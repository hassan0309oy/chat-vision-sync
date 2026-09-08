import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { parseMp4Metadata, analyzeAttachmentById } from "@/lib/providers/media-analysis.server";
import { extractAttachment } from "@/lib/providers/attachments.server";

const admin = createClient(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);

async function ensureUser(email: string) {
  const created = await admin.auth.admin.createUser({
    email,
    password: "Test-1234!",
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;
  const list = await admin.auth.admin.listUsers();
  const found = list.data.users.find((u) => u.email === email);
  if (!found) throw new Error(`Utilisateur ${email} introuvable: ${created.error?.message}`);
  return found.id;
}

const userA = await ensureUser("test-a@deerflow.test");
const userB = await ensureUser("test-b@deerflow.test");
console.log("A", userA, "B", userB);

const bytes = new Uint8Array(readFileSync("/tmp/test-video.mp4"));
console.log("métadonnées MP4 lues:", parseMp4Metadata(bytes));

const path = `${userA}/test-video-${Date.now()}.mp4`;
const up = await admin.storage.from("attachments").upload(path, bytes, { contentType: "video/mp4" });
console.log("upload:", up.error?.message ?? "ok");

const row = await admin
  .from("attachments")
  .insert({
    user_id: userA,
    name: "test-video.mp4",
    size: bytes.length,
    mime_type: "video/mp4",
    storage_path: path,
    status: "ready",
  })
  .select("id")
  .single();
console.log("attachment:", row.error?.message ?? row.data!.id);
const attachmentId = row.data!.id as string;

// Test 1 : analyse réelle de la vidéo par le propriétaire
try {
  const result = await analyzeAttachmentById({
    attachmentId,
    userId: userA,
    question: "Décris la chronologie, les plans et l'audio.",
  });
  console.log("TEST VIDEO OK — modèle:", result.model);
  console.log("technique:", JSON.stringify(result.technical));
  console.log(result.analysis.slice(0, 1200));
} catch (error) {
  console.log("TEST VIDEO ECHEC:", error instanceof Error ? error.message : error);
}

// Test 2 : isolation entre comptes
try {
  await analyzeAttachmentById({ attachmentId, userId: userB });
  console.log("ISOLATION ECHEC : l'utilisateur B a pu accéder au fichier de A");
} catch (error) {
  console.log("ISOLATION OK :", error instanceof Error ? error.message : error);
}

// Test 3 : extraction d'un document texte
const docPath = `${userA}/notes-${Date.now()}.txt`;
await admin.storage
  .from("attachments")
  .upload(docPath, new TextEncoder().encode("Budget 2026 : 45 000 EUR."), {
    contentType: "text/plain",
  });
const docRow = await admin
  .from("attachments")
  .insert({
    user_id: userA,
    name: "notes.txt",
    size: 25,
    mime_type: "text/plain",
    storage_path: docPath,
    status: "ready",
  })
  .select("*")
  .single();
console.log("EXTRACTION TEXTE:", JSON.stringify(await extractAttachment(docRow.data as never)));
