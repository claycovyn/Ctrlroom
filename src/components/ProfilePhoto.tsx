"use client";

import { Avatar } from "@/components/chat/Avatar";
import { ImageButtons, useImageSlot } from "@/components/ImageUpload";
import { AVATAR_BUCKET, AVATAR_HINT, AVATAR_MAX_BYTES, avatarFileProblem, avatarObjectPath, avatarPath } from "@/lib/avatar";
import { cloudErrorText } from "@/lib/cloudErrors";
import type { Profile } from "@/lib/types";

/** Upload, replace or remove your own profile photo. */
export function ProfilePhoto({ profile, onChange }: { profile: Profile; onChange?: (url: string | null) => void }) {
  const slot = useImageSlot({
    bucket: AVATAR_BUCKET,
    initial: profile.avatar_url,
    problem: avatarFileProblem,
    crop: { kind: "photo", maxBytes: AVATAR_MAX_BYTES, title: "Crop your photo", round: true },
    pathFor: (file) => avatarPath(profile.id, file.type),
    objectPathOf: (url) => avatarObjectPath(url, profile.id),
    save: async (supabase, url) => {
      const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile.id);
      return error ? (cloudErrorText(error.message) ?? "Couldn't save your photo.") : null;
    },
    removeError: "Couldn't remove your photo.",
    onChange,
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar profile={{ ...profile, avatar_url: slot.url }} size={64} />
      <div className="min-w-0 flex-1 basis-48">
        <ImageButtons slot={slot} id="profile-photo" hint={AVATAR_HINT} label="Profile photo" />
      </div>
    </div>
  );
}
