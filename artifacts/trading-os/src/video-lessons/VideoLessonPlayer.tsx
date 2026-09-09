import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark, Captions, ChevronLeft, ChevronRight, Expand, Gauge, Minimize2,
  Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Volume2, VolumeX, X,
} from "lucide-react";
import { getLessonMediaUrl } from "./api";
import type { LessonProgress, VideoLesson } from "./types";

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "00:00";
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

type Props = {
  lesson: VideoLesson;
  progress?: LessonProgress;
  saved: boolean;
  autoplay?: boolean;
  enableMiniPlayer?: boolean;
  onProgress: (patch: Partial<LessonProgress>, immediate?: boolean) => void;
  onToggleSaved: () => void;
  onPlayingChange?: (playing: boolean) => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function VideoLessonPlayer({
  lesson, progress, saved, autoplay = false, enableMiniPlayer = false, onProgress,
  onToggleSaved, onPlayingChange, onPrevious, onNext,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(autoplay);
  const [volume, setVolume] = useState(0.9);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(progress?.watchedSeconds || 0);
  const [duration, setDuration] = useState(lesson.duration || 0);
  const [captionsOn, setCaptionsOn] = useState(lesson.captionsEnabled);
  const [lyricsOn, setLyricsOn] = useState(true);
  const [showSpeed, setShowSpeed] = useState(false);
  const [isMini, setIsMini] = useState(false);
  const [miniClosed, setMiniClosed] = useState(false);

  useEffect(() => {
    let active = true;
    setVideoUrl(null);
    Promise.all([
      getLessonMediaUrl(lesson.videoObjectKey || lesson.videoPath, lesson.id, lesson.storageProvider),
      getLessonMediaUrl(lesson.thumbnailObjectKey || lesson.thumbnailPath, lesson.id, lesson.storageProvider),
    ]).then(([video, poster]) => {
      if (!active) return;
      setVideoUrl(video);
      setPosterUrl(poster);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [lesson.id, lesson.storageProvider, lesson.videoObjectKey, lesson.videoPath, lesson.thumbnailObjectKey, lesson.thumbnailPath]);

  useEffect(() => {
    if (!enableMiniPlayer || !anchorRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIsMini(!entry.isIntersecting && playing && !miniClosed);
    }, { threshold: 0.15 });
    observer.observe(anchorRef.current);
    return () => observer.disconnect();
  }, [enableMiniPlayer, playing, miniClosed]);

  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
    video.playbackRate = speed;
  }, [muted, volume, speed]);

  const activeCaption = useMemo(() => lesson.captions.find((caption) => currentTime >= caption.startTime && currentTime < caption.endTime), [lesson.captions, currentTime]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) await video.play();
    else video.pause();
  };

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || duration, videoRef.current.currentTime + seconds));
  };

  const fullscreen = async () => {
    const container = videoRef.current?.parentElement;
    if (container?.requestFullscreen) await container.requestFullscreen();
  };

  const pictureInPicture = async () => {
    const video = videoRef.current;
    if (video && document.pictureInPictureEnabled && !video.disablePictureInPicture) await video.requestPictureInPicture();
  };

  const controlButton = "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-950/55 text-slate-200 transition hover:border-cyan-400/30 hover:text-cyan-300 active:scale-95";

  return (
    <>
      <div ref={anchorRef} className="h-px w-full" aria-hidden="true" />
      <div className={isMini
        ? "fixed bottom-[calc(74px+env(safe-area-inset-bottom))] left-3 right-3 z-[70] mx-auto max-w-xl overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#07101f]/95 shadow-2xl shadow-black/80 backdrop-blur-xl"
        : "relative overflow-hidden rounded-2xl border border-cyan-400/15 bg-[#050914] shadow-2xl shadow-black/60"}>
        {isMini && (
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold text-slate-100">{lesson.title}</div>
              <div className="text-[10px] text-slate-500">{formatTime(currentTime)} / {formatTime(duration)}</div>
            </div>
            <button className={controlButton} onClick={() => { setMiniClosed(true); setIsMini(false); videoRef.current?.pause(); }} aria-label="Close mini player"><X size={15} /></button>
          </div>
        )}

        <div className={isMini ? "grid grid-cols-[132px_1fr] items-center" : "relative aspect-video min-h-[210px] w-full bg-black"}>
          <div className={isMini ? "relative aspect-video bg-black" : "absolute inset-0"}>
            {posterUrl && <img src={posterUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" aria-hidden="true" />}
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                poster={posterUrl || undefined}
                preload="metadata"
                playsInline
                autoPlay={autoplay}
                muted={muted}
                className="relative h-full w-full bg-black/20 object-contain"
                onClick={() => void togglePlay()}
                onPlay={() => { setPlaying(true); setMiniClosed(false); }}
                onPause={() => { setPlaying(false); onProgress({ watchedSeconds: currentTime, percentage: duration ? Math.min(100, currentTime / duration * 100) : 0 }, true); }}
                onEnded={() => { setPlaying(false); onProgress({ watchedSeconds: duration, percentage: 100, completed: true }, true); }}
                onLoadedMetadata={(event) => {
                  const nextDuration = event.currentTarget.duration || lesson.duration;
                  setDuration(nextDuration);
                  if ((progress?.watchedSeconds || 0) > 0 && (progress?.watchedSeconds || 0) < nextDuration - 3) event.currentTarget.currentTime = progress?.watchedSeconds || 0;
                }}
                onTimeUpdate={(event) => {
                  const time = event.currentTarget.currentTime;
                  const total = event.currentTarget.duration || duration;
                  setCurrentTime(time);
                  onProgress({ watchedSeconds: time, percentage: total ? Math.min(100, time / total * 100) : 0, completed: total > 0 && time / total >= 0.95 });
                }}
              />
            ) : <div className="flex h-full items-center justify-center text-xs text-slate-500">Preparing secure video…</div>}

            {!isMini && captionsOn && lyricsOn && activeCaption && (
              <div className="pointer-events-none absolute inset-x-4 bottom-20 flex justify-center">
                <div className="max-w-2xl rounded-2xl border border-white/10 bg-black/65 px-5 py-3 text-center text-sm font-semibold leading-relaxed text-white shadow-xl backdrop-blur-md md:text-base">
                  <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-violet-300 bg-clip-text text-transparent">{activeCaption.text}</span>
                </div>
              </div>
            )}
          </div>

          {isMini ? (
            <div className="flex items-center justify-center gap-2 p-3">
              {onPrevious && <button className={controlButton} onClick={onPrevious} aria-label="Previous lesson"><ChevronLeft size={16} /></button>}
              <button className={controlButton} onClick={() => void togglePlay()} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
              {onNext && <button className={controlButton} onClick={onNext} aria-label="Next lesson"><ChevronRight size={16} /></button>}
            </div>
          ) : (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-10">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium text-slate-300">
                <span>{formatTime(currentTime)}</span>
                <input aria-label="Video progress" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} className="h-1 flex-1 cursor-pointer accent-cyan-400" />
                <span>{formatTime(duration)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button className={controlButton} onClick={() => void togglePlay()} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
                  <button className={controlButton} onClick={() => seek(-10)} aria-label="Back 10 seconds"><RotateCcw size={16} /></button>
                  <button className={controlButton} onClick={() => seek(10)} aria-label="Forward 10 seconds"><RotateCw size={16} /></button>
                  <button className={controlButton} onClick={() => setMuted((value) => !value)} aria-label={muted ? "Turn voice on" : "Mute voice"}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                  <input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => { setVolume(Number(event.target.value)); setMuted(false); }} className="hidden w-16 accent-cyan-400 sm:block" />
                </div>
                <div className="flex items-center gap-1.5">
                  <button className={`${controlButton} ${captionsOn ? "border-cyan-400/40 text-cyan-300" : ""}`} onClick={() => setCaptionsOn((value) => !value)} aria-label="Toggle captions"><Captions size={17} /></button>
                  <button className={`${controlButton} ${lyricsOn ? "border-violet-400/40 text-violet-300" : ""}`} onClick={() => setLyricsOn((value) => !value)} aria-label="Toggle live lyrics"><span className="text-[9px] font-black">LYR</span></button>
                  <div className="relative">
                    <button className={controlButton} onClick={() => setShowSpeed((value) => !value)} aria-label="Playback speed"><Gauge size={16} /></button>
                    {showSpeed && <div className="absolute bottom-11 right-0 z-20 grid w-24 gap-1 rounded-xl border border-white/10 bg-slate-950 p-1.5 shadow-xl">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <button key={value} onClick={() => { setSpeed(value); setShowSpeed(false); }} className={`rounded-lg px-2 py-1 text-xs ${speed === value ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-white/5"}`}>{value}x</button>)}</div>}
                  </div>
                  <button className={`${controlButton} ${saved ? "text-cyan-300" : ""}`} onClick={onToggleSaved} aria-label="Save lesson"><Bookmark size={16} fill={saved ? "currentColor" : "none"} /></button>
                  <button className={`${controlButton} hidden sm:inline-flex`} onClick={() => void pictureInPicture()} aria-label="Picture in picture"><PictureInPicture2 size={16} /></button>
                  <button className={controlButton} onClick={() => void fullscreen()} aria-label="Fullscreen"><Expand size={16} /></button>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isMini && (
          <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5 text-[10px] text-slate-500">
            <div className="flex items-center gap-2"><span className="rounded-full bg-cyan-400/10 px-2 py-1 text-cyan-300">Voice · Original</span><span>{speed}x</span></div>
            <div className="flex items-center gap-1"><Minimize2 size={12} /> Mini-player follows while watching</div>
          </div>
        )}
      </div>
    </>
  );
}

export { formatTime };
