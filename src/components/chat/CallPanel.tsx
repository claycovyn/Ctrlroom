"use client";

import "@livekit/components-styles";
import { LiveKitRoom, VideoConference, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, type Participant, type TrackPublication } from "livekit-client";
import { useEffect, useState } from "react";
import { play } from "@/lib/sounds";
import { PhoneIcon } from "./icons";
import { usePresence } from "./PresenceContext";

export default function CallPanel({
  roomId,
  roomName,
  enabled,
  joinNow = 0,
}: {
  roomId: string;
  roomName: string;
  enabled: boolean;
  /** Bump to join with voice right away (the "a call started" banner). */
  joinNow?: number;
}) {
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [startVideo, setStartVideo] = useState(false);

  useEffect(() => {
    if (joinNow && enabled && !conn && !joining) join(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinNow]);

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
        onConnected={() => play("call-join")}
        onDisconnected={() => {
          play("call-leave");
          setConn(null);
        }}
        onError={(e) => setError(e.message)}
        style={{ height: "100%" }}
      >
        <CallSounds />
        <CallPresence roomId={roomId} />
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}

/** Join / leave chimes for other people, and the mic mute / unmute clicks for you. */
function CallSounds() {
  const room = useRoomContext();
  useEffect(() => {
    const joined = () => play("call-join");
    const left = () => play("call-leave");
    const mic = (sound: "mute" | "unmute") => (pub: TrackPublication, who: Participant) => {
      if (who === room.localParticipant && pub.source === Track.Source.Microphone) play(sound);
    };
    const muted = mic("mute");
    const unmuted = mic("unmute");
    room.on(RoomEvent.ParticipantConnected, joined);
    room.on(RoomEvent.ParticipantDisconnected, left);
    room.on(RoomEvent.TrackMuted, muted);
    room.on(RoomEvent.TrackUnmuted, unmuted);
    return () => {
      room.off(RoomEvent.ParticipantConnected, joined);
      room.off(RoomEvent.ParticipantDisconnected, left);
      room.off(RoomEvent.TrackMuted, muted);
      room.off(RoomEvent.TrackUnmuted, unmuted);
    };
  }, [room]);
  return null;
}

/** Tells presence you're in this call, and whether your camera is on ("In a video call"). */
function CallPresence({ roomId }: { roomId: string }) {
  const setMyCall = usePresence()?.setMyCall;
  const { isCameraEnabled } = useLocalParticipant();
  useEffect(() => {
    setMyCall?.({ room_id: roomId, video: isCameraEnabled });
  }, [setMyCall, roomId, isCameraEnabled]);
  useEffect(() => () => setMyCall?.(null), [setMyCall]);
  return null;
}
