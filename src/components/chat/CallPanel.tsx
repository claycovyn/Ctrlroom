"use client";

import "@livekit/components-styles";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import { useState } from "react";
import { PhoneIcon } from "./icons";

export default function CallPanel({ roomId, roomName, enabled }: { roomId: string; roomName: string; enabled: boolean }) {
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [startVideo, setStartVideo] = useState(false);

  const join = async (video: boolean) => {
    setJoining(true);
    setError(null);
    const res = await fetch("/api/livekit/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    });
    const data = await res.json().catch(() => ({}));
    setJoining(false);
    if (!res.ok) return setError(data.error ?? "Couldn't join the call.");
    setStartVideo(video);
    setConn({ token: data.token, url: data.url });
  };

  if (!conn) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-raised/40 px-4 py-3">
        <PhoneIcon className="h-5 w-5 text-signal" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Call in #{roomName}</p>
          <p className="text-xs text-muted">
            {enabled ? "Talk, turn on your camera or share your screen. Anyone in the room can drop in." : "Voice and video need LiveKit keys (see README)."}
          </p>
          {error && <p className="mt-1 text-xs text-alert">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary py-1.5 text-xs" disabled={!enabled || joining} onClick={() => join(false)}>
            {joining ? "Connecting…" : "Join voice"}
          </button>
          <button className="btn-outline py-1.5 text-xs" disabled={!enabled || joining} onClick={() => join(true)}>
            Join with video
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[55vh] min-h-[320px] border-b border-line" data-lk-theme="default">
      <LiveKitRoom
        serverUrl={conn.url}
        token={conn.token}
        connect
        audio
        video={startVideo}
        onDisconnected={() => setConn(null)}
        onError={(e) => setError(e.message)}
        style={{ height: "100%" }}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
