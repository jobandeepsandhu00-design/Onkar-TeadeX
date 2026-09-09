import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, Bookmark, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Copy, Film, ImagePlus, ListVideo, Loader2, Pencil, Play, Plus, Search,
  Settings2, Sparkles, Star, Trash2, Upload, Video, X,
} from "lucide-react";
import {
  deleteVideoLesson,
  generateLessonTranscript,
  getLessonMediaUrl,
  makeCaption,
  makeChecklistItem,
  makeRule,
  removeLessonMedia,
  saveVideoLesson,
  uploadLessonMedia,
} from "./api";
import { VideoLessonPlayer, formatTime } from "./VideoLessonPlayer";
import { useVideoLearning } from "./useVideoLearning";
import type { LessonDraft, LessonProgress, VideoLesson } from "./types";
import {
  DASHBOARD_PLACEMENTS, LESSON_CATEGORIES, LESSON_DIFFICULTIES, LESSON_TIMEFRAMES,
} from "./types";

const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.06] hover:text-cyan-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2.5 text-xs font-black text-[#04101e] shadow-lg shadow-cyan-500/15 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45";
const input = "w-full rounded-xl border border-white/10 bg-[#07101f] px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/10";
const panel = "rounded-2xl border border-cyan-400/10 bg-[#0b1425]/90 shadow-xl shadow-black/20";

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
const reorder = <T,>(items: T[], index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

function useSignedMedia(path: string | null | undefined, lessonId: string, provider: VideoLesson["storageProvider"]) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setUrl(null);
    getLessonMediaUrl(path, lessonId, provider).then((next) => { if (active) setUrl(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [lessonId, path, provider]);
  return url;
}

function LoadingCard() {
  return <div className={`${panel} animate-pulse p-4`}><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-3 h-4 w-2/3 rounded bg-white/5" /><div className="mt-2 h-3 w-1/2 rounded bg-white/5" /></div>;
}

function EmptyLearning({ canManage, onManage, error }: { canManage: boolean; onManage?: () => void; error?: string | null }) {
  return (
    <div className={`${panel} flex min-h-52 flex-col items-center justify-center p-7 text-center`}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300"><Film size={22} /></div>
      <h3 className="text-sm font-bold text-slate-100">{error ? "Video learning needs attention" : "Your strategy cinema is ready"}</h3>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500">{error || "Upload your first original trading lesson. It will appear here after you publish it to the Dashboard slider."}</p>
      {canManage && onManage && <button className={`${primaryButton} mt-4`} onClick={onManage}><Upload size={15} /> Upload first lesson</button>}
    </div>
  );
}

type StrategyCardProps = {
  lesson: VideoLesson;
  progress?: LessonProgress;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
};

export function StrategyCard({ lesson, progress, saved, onOpen, onSave }: StrategyCardProps) {
  const thumbnailUrl = useSignedMedia(lesson.thumbnailObjectKey || lesson.thumbnailPath, lesson.id, lesson.storageProvider);
  const preview = lesson.captions[0]?.text || lesson.shortDescription;
  return (
    <article className={`${panel} group overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-cyan-400/25`}>
      <button onClick={onOpen} className="relative block aspect-video w-full overflow-hidden bg-[#050914] text-left">
        {thumbnailUrl ? <img src={thumbnailUrl} alt={lesson.title} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" /> : <div className="flex h-full items-center justify-center text-cyan-400/30"><Video size={34} /></div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <span className="absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">{formatTime(lesson.duration)}</span>
        <span className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-cyan-200 backdrop-blur">{lesson.difficulty}</span>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-xl shadow-cyan-500/30"><Play size={19} fill="currentColor" /></span></span>
      </button>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <button onClick={onOpen} className="min-w-0 text-left"><h3 className="truncate text-sm font-bold text-slate-100">{lesson.title}</h3><p className="mt-1 text-[10px] text-slate-500">{lesson.timeframe} · {lesson.category}</p></button>
          <button onClick={onSave} className={`shrink-0 rounded-lg border border-white/10 p-2 ${saved ? "text-cyan-300" : "text-slate-500 hover:text-cyan-300"}`} aria-label="Save lesson"><Bookmark size={14} fill={saved ? "currentColor" : "none"} /></button>
        </div>
        {preview && <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-slate-400">“{preview}”</p>}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" style={{ width: `${progress?.percentage || 0}%` }} /></div>
        <div className="mt-1.5 flex justify-between text-[9px] font-medium text-slate-600"><span>{progress?.percentage ? `${Math.round(progress.percentage)}% watched` : "Not started"}</span><span>Voice · CC</span></div>
      </div>
    </article>
  );
}

function LessonMiniCard({ lesson, progress, active = false, onSelect }: {
  lesson: VideoLesson;
  progress?: LessonProgress;
  active?: boolean;
  onSelect: () => void;
}) {
  const thumbnailUrl = useSignedMedia(lesson.thumbnailObjectKey || lesson.thumbnailPath, lesson.id, lesson.storageProvider);
  const uploadedAt = Date.parse(lesson.createdAt);
  const isNew = Number.isFinite(uploadedAt) && Date.now() - uploadedAt < 14 * 24 * 60 * 60 * 1000;
  const watched = Math.max(0, Math.min(100, progress?.percentage || 0));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${active ? "Currently selected" : "Select"} ${lesson.title}`}
      aria-pressed={active}
      className={`group w-[168px] shrink-0 snap-start overflow-hidden rounded-xl border text-left transition duration-200 sm:w-[200px] ${active ? "border-cyan-300/55 bg-cyan-400/[0.08] shadow-lg shadow-cyan-500/10" : "border-white/8 bg-[#081221]/90 hover:-translate-y-0.5 hover:border-cyan-400/25"}`}
    >
      <span className="relative block aspect-video overflow-hidden bg-[#030711]">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="flex h-full items-center justify-center text-cyan-400/30"><Video size={25} /></span>}
        <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-transparent" />
        {isNew && <span className="absolute left-2 top-2 rounded-md border border-cyan-300/25 bg-cyan-300/90 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#03101a]">New</span>}
        {active && <span className="absolute bottom-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-300 text-[#03101a] shadow-lg shadow-cyan-400/25"><Play size={11} fill="currentColor" /></span>}
        <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">{formatTime(lesson.duration)}</span>
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10"><span className="block h-full bg-gradient-to-r from-cyan-300 to-violet-400" style={{ width: `${watched}%` }} /></span>
      </span>
      <span className="block p-2.5">
        <span className="line-clamp-2 min-h-8 text-[11px] font-bold leading-4 text-slate-100">{lesson.title}</span>
        <span className="mt-1 flex items-center gap-1 truncate text-[9px] text-slate-500"><span>{lesson.category}</span><span aria-hidden="true">·</span><span>{lesson.timeframe}</span></span>
      </span>
    </button>
  );
}

function LessonPopup({ lesson, progress, saved, onClose, onOpen, onProgress, onSave, onNext }: {
  lesson: VideoLesson; progress?: LessonProgress; saved: boolean; onClose: () => void; onOpen: () => void;
  onProgress: (patch: Partial<LessonProgress>, immediate?: boolean) => void; onSave: () => void; onNext: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#020617]/90 p-3 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label={lesson.title} onClick={onClose}>
      <div className="mx-auto my-4 max-w-5xl" onClick={(event) => event.stopPropagation()}>
        <div className={`${panel} overflow-hidden border-cyan-400/20`}>
          <div className="flex items-center justify-between px-4 py-3"><div><div className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300">Strategy Lesson</div><h2 className="mt-1 text-lg font-black text-white">{lesson.title}</h2></div><button className={button} onClick={onClose} aria-label="Close"><X size={16} /></button></div>
          <VideoLessonPlayer lesson={lesson} progress={progress} saved={saved} onProgress={onProgress} onToggleSaved={onSave} onNext={onNext} />
          <div className="grid gap-4 p-4 md:grid-cols-[1fr_320px]">
            <div><p className="text-sm leading-relaxed text-slate-300">{lesson.description || lesson.shortDescription}</p><div className="mt-4 flex flex-wrap gap-2">{lesson.tags.map((tag) => <span key={tag} className="rounded-full bg-cyan-400/[0.07] px-2.5 py-1 text-[10px] text-cyan-200">#{tag}</span>)}</div></div>
            <div className="rounded-xl border border-white/8 bg-black/15 p-3"><div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Key rules</div><ul className="mt-2 space-y-2">{lesson.rules.slice(0, 4).map((rule) => <li key={rule.id} className="flex gap-2 text-xs text-slate-300"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-cyan-300" />{rule.text}</li>)}</ul></div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-4 py-3"><button className={button} onClick={onSave}><Bookmark size={14} /> {saved ? "Saved" : "Save"}</button><button className={button} onClick={onNext}>Next Strategy <ChevronRight size={14} /></button><button className={primaryButton} onClick={onOpen}>Open Lesson</button></div>
        </div>
      </div>
    </div>
  );
}

export function DashboardVideoSection({ onOpenLesson, onManage }: { onOpenLesson: (id: string) => void; onManage: () => void }) {
  const learning = useVideoLearning();
  const published = useMemo(() => learning.lessons.filter((lesson) => lesson.published), [learning.lessons]);
  const featured = useMemo(() => {
    return [...published].sort((a, b) => {
      const aFeatured = a.featured || a.placements.includes("home_slider") ? 1 : 0;
      const bFeatured = b.featured || b.placements.includes("home_slider") ? 1 : 0;
      if (aFeatured !== bFeatured) return bFeatured - aFeatured;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [published]);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [popup, setPopup] = useState(false);
  const [category, setCategory] = useState("For You");
  const [autoRotate, setAutoRotate] = useState(() => localStorage.getItem("otx_lesson_autorotate") !== "false");
  const [intervalSeconds, setIntervalSeconds] = useState(() => Number(localStorage.getItem("otx_lesson_interval") || 10));
  const touchStart = useRef<number | null>(null);
  const lessonRail = useRef<HTMLDivElement | null>(null);
  const popularRail = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoRotate || playing || featured.length < 2) return;
    const timer = setInterval(() => {
      if (!document.hidden) setActive((index) => (index + 1) % featured.length);
    }, intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [autoRotate, playing, featured.length, intervalSeconds]);
  useEffect(() => { if (active >= featured.length) setActive(0); }, [active, featured.length]);

  const current = featured[active];
  const navigate = (direction: -1 | 1) => setActive((index) => (index + direction + featured.length) % featured.length);
  const selectLesson = (lessonId: string) => {
    const index = featured.findIndex((lesson) => lesson.id === lessonId);
    if (index >= 0) {
      setPlaying(false);
      setActive(index);
    }
  };
  const scrollRail = (rail: React.RefObject<HTMLDivElement | null>, direction: -1 | 1) => rail.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  const categories = ["For You", "Trending", "Beginner", "Advanced", "Price Action", "Smart Money", "Trend", "Breakouts", "Risk Management", "All"];
  const popular = published.filter((lesson) => {
    if (["For You", "Trending", "All"].includes(category)) return true;
    if (["Beginner", "Advanced"].includes(category)) return lesson.difficulty === category;
    if (category === "Breakouts") return lesson.category === "Breakout";
    return lesson.category === category;
  });
  const newestFirst = useMemo(() => [...published].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [published]);
  const continueLessons = published.filter((lesson) => (learning.progress[lesson.id]?.percentage || 0) > 0 && !learning.progress[lesson.id]?.completed).sort((a, b) => (learning.progress[b.id]?.lastWatchedAt || "").localeCompare(learning.progress[a.id]?.lastWatchedAt || "")).slice(0, 3);

  if (learning.loading) return <section className="space-y-3"><LoadingCard /></section>;
  if (!current) return <section><EmptyLearning canManage={learning.canManage} onManage={onManage} error={learning.error} /></section>;

  return (
    <section className="space-y-4" aria-labelledby="featured-strategy-heading">
      <div className={`${panel} overflow-hidden border-cyan-400/20`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <div><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.24em] text-cyan-300"><Star size={12} fill="currentColor" /> Featured Strategy</div><h2 id="featured-strategy-heading" className="mt-1 text-lg font-black text-white">Video Strategy Learning</h2><p className="text-[11px] text-slate-500">Study the original lesson. Keep the chart, voice, captions, and rules together.</p></div>
          <div className="flex items-center gap-2"><button className={button} onClick={() => navigate(-1)} aria-label="Previous strategy"><ChevronLeft size={15} /></button><button className={button} onClick={() => navigate(1)} aria-label="Next strategy"><ChevronRight size={15} /></button><button className={button} onClick={onManage}><ListVideo size={15} /> Learn</button></div>
        </div>

        <div className="relative p-3 md:p-5" onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }} onTouchEnd={(event) => { if (touchStart.current === null) return; const distance = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(distance) > 55) navigate(distance > 0 ? -1 : 1); touchStart.current = null; }}>
          <div className="pointer-events-none absolute inset-y-10 -left-8 hidden w-20 rounded-2xl border border-white/5 bg-white/[0.02] opacity-60 md:block" /><div className="pointer-events-none absolute inset-y-10 -right-8 hidden w-20 rounded-2xl border border-white/5 bg-white/[0.02] opacity-60 md:block" />
          <div className="mx-auto max-w-5xl">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><div className="flex flex-wrap gap-1.5"><span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-2 py-1 text-[9px] font-bold text-cyan-200">{current.category}</span><span className="rounded-full border border-violet-400/20 bg-violet-400/[0.06] px-2 py-1 text-[9px] font-bold text-violet-200">{current.difficulty}</span><span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-bold text-slate-400">{current.timeframe}</span></div><button onClick={() => onOpenLesson(current.id)} className="mt-2 text-left text-xl font-black text-white hover:text-cyan-200 md:text-2xl">{current.title}</button><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{current.shortDescription}</p></div><button className={primaryButton} onClick={() => setPopup(true)}><Play size={15} /> Open Lesson</button></div>
            <VideoLessonPlayer key={current.id} lesson={current} progress={learning.progress[current.id]} saved={learning.savedIds.includes(current.id)} autoplay={current.autoplay} enableMiniPlayer onProgress={(patch, immediate) => learning.updateProgress(current.id, patch, immediate)} onToggleSaved={() => void learning.toggleSaved(current.id)} onPlayingChange={setPlaying} onPrevious={() => navigate(-1)} onNext={() => navigate(1)} />
            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/15 p-3">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Latest & all lessons</div><div className="mt-0.5 text-[9px] text-slate-600">{published.length} videos · swipe or tap to switch</div></div>
                <div className="flex shrink-0 gap-1.5"><button type="button" onClick={() => scrollRail(lessonRail, -1)} className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:border-cyan-400/30 hover:text-cyan-200" aria-label="Scroll lessons left"><ChevronLeft size={14} /></button><button type="button" onClick={() => scrollRail(lessonRail, 1)} className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:border-cyan-400/30 hover:text-cyan-200" aria-label="Scroll lessons right"><ChevronRight size={14} /></button></div>
              </div>
              <div ref={lessonRail} className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {newestFirst.map((lesson) => <LessonMiniCard key={lesson.id} lesson={lesson} progress={learning.progress[lesson.id]} active={lesson.id === current.id} onSelect={() => selectLesson(lesson.id)} />)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1.5">{featured.map((lesson, index) => <button key={lesson.id} onClick={() => setActive(index)} aria-label={`Show ${lesson.title}`} className={`h-1.5 rounded-full transition-all ${index === active ? "w-7 bg-cyan-300" : "w-1.5 bg-slate-700 hover:bg-slate-500"}`} />)}</div><div className="flex items-center gap-2 text-[10px] text-slate-500"><label className="flex items-center gap-1.5"><input type="checkbox" checked={autoRotate} onChange={(event) => { setAutoRotate(event.target.checked); localStorage.setItem("otx_lesson_autorotate", String(event.target.checked)); }} className="accent-cyan-400" /> Auto rotate</label><select value={intervalSeconds} onChange={(event) => { const value = Number(event.target.value); setIntervalSeconds(value); localStorage.setItem("otx_lesson_interval", String(value)); }} className="rounded-lg border border-white/10 bg-[#07101f] px-2 py-1 text-slate-400">{[5, 10, 15, 30].map((value) => <option key={value} value={value}>{value}s</option>)}</select></div></div>
          </div>
        </div>
      </div>

      {continueLessons.length > 0 && <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-black text-slate-100">Continue Learning</h3><span className="text-[10px] text-slate-500">Resume exactly where you stopped</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{continueLessons.map((lesson) => <StrategyCard key={lesson.id} lesson={lesson} progress={learning.progress[lesson.id]} saved={learning.savedIds.includes(lesson.id)} onOpen={() => onOpenLesson(lesson.id)} onSave={() => void learning.toggleSaved(lesson.id)} />)}</div></div>}

      <div>
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`${button} whitespace-nowrap ${category === item ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-200" : ""}`}>{item}</button>)}</div>
        <div className="mb-2 flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-slate-100">Popular Strategies</h3><p className="text-[9px] text-slate-600">Compact library · swipe to explore</p></div><div className="flex items-center gap-1.5"><button type="button" onClick={() => scrollRail(popularRail, -1)} className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:text-cyan-200" aria-label="Scroll popular lessons left"><ChevronLeft size={14} /></button><button type="button" onClick={() => scrollRail(popularRail, 1)} className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:text-cyan-200" aria-label="Scroll popular lessons right"><ChevronRight size={14} /></button><button onClick={onManage} className="ml-1 text-[11px] font-semibold text-cyan-300">View all →</button></div></div>
        <div ref={popularRail} className="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{popular.map((lesson) => <LessonMiniCard key={lesson.id} lesson={lesson} progress={learning.progress[lesson.id]} onSelect={() => onOpenLesson(lesson.id)} />)}</div>
      </div>

      {popup && <LessonPopup lesson={current} progress={learning.progress[current.id]} saved={learning.savedIds.includes(current.id)} onClose={() => setPopup(false)} onOpen={() => onOpenLesson(current.id)} onProgress={(patch, immediate) => learning.updateProgress(current.id, patch, immediate)} onSave={() => void learning.toggleSaved(current.id)} onNext={() => navigate(1)} />}
    </section>
  );
}

type Stage = { label: string; status: "waiting" | "active" | "done" | "error" };

function getVideoMetadata(file: File): Promise<{ duration: number; thumbnail: File | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(Math.max(video.duration * 0.12, 0.1), Math.max(video.duration - 0.1, 0.1));
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const width = Math.min(video.videoWidth || 1280, 1280);
        const height = Math.round(width * (video.videoHeight || 720) / (video.videoWidth || 1280));
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve({ duration: video.duration || 0, thumbnail: blob ? new File([blob], "auto-thumbnail.webp", { type: "image/webp" }) : null });
        }, "image/webp", 0.86);
      } catch { URL.revokeObjectURL(url); resolve({ duration: video.duration || 0, thumbnail: null }); }
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This video could not be read by the browser.")); };
    video.src = url;
  });
}

function createDraft(initial?: VideoLesson): LessonDraft {
  if (initial) {
    const { ownerId: _ownerId, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = initial;
    return structuredClone(draft);
  }
  return {
    id: crypto.randomUUID(), title: "", slug: "", shortDescription: "", description: "",
    category: "Price Action", difficulty: "Beginner", timeframe: "Multiple", tags: [],
    videoPath: "", thumbnailPath: null, duration: 0, audioType: "original_video_audio",
    storageProvider: "cloudflare_r2", videoObjectKey: null, videoFileName: "", videoSizeBytes: null,
    videoMimeType: "", thumbnailObjectKey: null, captionObjectKey: null, audioObjectKey: null,
    uploadStatus: "pending", processingStatus: "pending",
    captionsEnabled: true, autoplay: false, published: false, featured: false, sortOrder: 0,
    captions: [], rules: [], checklist: [], placements: ["learn_only"],
  };
}

function LessonEditor({ initial, onCancel, onSaved }: { initial?: VideoLesson; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<LessonDraft>(() => createDraft(initial));
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([
    { label: "Uploading Video", status: "waiting" }, { label: "Extracting Audio", status: "waiting" },
    { label: "Generating Transcript", status: "waiting" }, { label: "Creating Synced Captions", status: "waiting" },
    { label: "Generating Thumbnail", status: "waiting" }, { label: "Saving Lesson", status: "waiting" },
  ]);
  const videoInput = useRef<HTMLInputElement>(null);
  const thumbInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);

  const setStage = (index: number, status: Stage["status"]) => setStages((current) => current.map((stage, stageIndex) => stageIndex === index ? { ...stage, status } : stage));
  const update = <K extends keyof LessonDraft>(key: K, value: LessonDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const processVideo = async (file: File) => {
    const controller = new AbortController();
    uploadController.current = controller;
    setBusy(true); setMessage(null);
    setUploadPercent(0);
    setStages((current) => current.map((stage) => ({ ...stage, status: "waiting" })));
    let uploadedPath: string | null = null;
    try {
      setStage(0, "active");
      const metadataPromise = getVideoMetadata(file);
      const uploaded = await uploadLessonMedia(file, "videos", draft.id, setUploadPercent, controller.signal);
      uploadedPath = uploaded.objectKey;
      setStage(0, "done");
      const metadata = await metadataPromise;
      setDraft((current) => ({
        ...current,
        videoPath: uploaded.objectKey,
        videoObjectKey: uploaded.objectKey,
        storageProvider: uploaded.storageProvider,
        videoFileName: uploaded.fileName,
        videoSizeBytes: uploaded.size,
        videoMimeType: uploaded.mimeType,
        uploadStatus: "uploaded",
        processingStatus: "processing",
        duration: metadata.duration,
      }));

      setStage(4, "active");
      if (metadata.thumbnail) {
        const thumbnail = await uploadLessonMedia(metadata.thumbnail, "thumbnails", draft.id, undefined, controller.signal);
        setDraft((current) => ({ ...current, thumbnailPath: thumbnail.objectKey, thumbnailObjectKey: thumbnail.objectKey }));
      }
      setStage(4, "done");

      setStage(1, "active"); setStage(1, "done");
      setStage(2, "active");
      try {
        const transcript = await generateLessonTranscript(uploadedPath, draft.id, draft.title || file.name.replace(/\.[^.]+$/, ""), "cloudflare_r2");
        setStage(2, "done"); setStage(3, "active");
        setDraft((current) => ({
          ...current,
          videoPath: uploadedPath || current.videoPath,
          duration: metadata.duration,
          thumbnailPath: current.thumbnailPath,
          uploadStatus: "ready",
          processingStatus: "ready",
          shortDescription: current.shortDescription || transcript.shortDescription || "",
          description: current.description || transcript.description || "",
          tags: current.tags.length ? current.tags : (transcript.tags || []),
          captions: transcript.captions.map((caption, order) => makeCaption(caption.text, caption.startTime, caption.endTime, order)),
          rules: current.rules.length ? current.rules : (transcript.rules || []).map((text, order) => makeRule(text, order)),
          checklist: current.checklist.length ? current.checklist : (transcript.checklist || []).map((text, order) => makeChecklistItem(text, order)),
        }));
        if (!tagText && transcript.tags?.length) setTagText(transcript.tags.join(", "));
        setStage(3, "done");
      } catch (cause) {
        setStage(2, "error"); setStage(3, "error");
        setDraft((current) => ({ ...current, uploadStatus: "uploaded", processingStatus: "failed" }));
        setMessage(`${cause instanceof Error ? cause.message : "Automatic transcription failed."} The original video is uploaded; you can add captions manually and save the draft.`);
      }
    } catch (cause) {
      if (uploadedPath) await removeLessonMedia(uploadedPath, draft.id, "cloudflare_r2").catch(() => undefined);
      setStage(0, "error");
      setMessage(cause instanceof Error ? cause.message : "Video upload failed.");
    } finally { uploadController.current = null; setBusy(false); }
  };

  const uploadThumbnail = async (file: File) => {
    setBusy(true); setMessage(null); setStage(4, "active");
    try {
      const next = await uploadLessonMedia(file, "thumbnails", draft.id);
      if (draft.thumbnailPath) await removeLessonMedia(draft.thumbnailPath, draft.id, draft.storageProvider).catch(() => undefined);
      setDraft((current) => ({ ...current, thumbnailPath: next.objectKey, thumbnailObjectKey: next.objectKey, storageProvider: next.storageProvider })); setStage(4, "done");
    } catch (cause) { setStage(4, "error"); setMessage(cause instanceof Error ? cause.message : "Thumbnail upload failed."); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!draft.title.trim() || !draft.videoPath) { setMessage("Add a strategy name and upload the original video first."); return; }
    setBusy(true); setMessage(null); setStage(5, "active");
    try {
      await saveVideoLesson({ ...draft, slug: slugify(draft.slug || draft.title), tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean) });
      setStage(5, "done"); onSaved();
    } catch (cause) { setStage(5, "error"); setMessage(cause instanceof Error ? cause.message : "Lesson could not be saved."); }
    finally { setBusy(false); }
  };

  const listEditor = <T extends { id: string; text: string; order: number }>(label: string, items: T[], setItems: (items: T[]) => void, factory: (text: string, order: number) => T, time = false) => (
    <div className={`${panel} p-4`}><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-100">{label}</h3><p className="text-[10px] text-slate-500">Edit, delete, or reorder each item.</p></div><button className={button} onClick={() => setItems([...items, factory("", items.length)])}><Plus size={14} /> Add</button></div><div className="space-y-2">{items.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-600">No items yet.</div>}{items.map((item, index) => <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-white/8 bg-black/15 p-2"><div>{time && <div className="mb-2 grid grid-cols-2 gap-2"><input type="number" step="0.1" min="0" value={(item as unknown as { startTime: number }).startTime} onChange={(event) => setItems(items.map((current) => current.id === item.id ? { ...current, startTime: Number(event.target.value) } : current) as T[])} className={input} aria-label="Caption start time" /><input type="number" step="0.1" min="0" value={(item as unknown as { endTime: number }).endTime} onChange={(event) => setItems(items.map((current) => current.id === item.id ? { ...current, endTime: Number(event.target.value) } : current) as T[])} className={input} aria-label="Caption end time" /></div>}<textarea value={item.text} onChange={(event) => setItems(items.map((current) => current.id === item.id ? { ...current, text: event.target.value } : current) as T[])} rows={time ? 2 : 1} className={input} placeholder={time ? "Caption text…" : `${label}…`} /></div><div className="flex flex-col gap-1"><button className={button} onClick={() => setItems(reorder(items, index, -1))} disabled={index === 0}>↑</button><button className={button} onClick={() => setItems(reorder(items, index, 1))} disabled={index === items.length - 1}>↓</button><button className={`${button} hover:text-rose-300`} onClick={() => setItems(items.filter((current) => current.id !== item.id))}><Trash2 size={13} /></button></div></div>)}</div></div>
  );

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-3"><button className={button} onClick={onCancel}><ArrowLeft size={15} /> Back</button><div className="text-right"><div className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">Video Manager</div><h2 className="text-lg font-black text-white">{initial ? "Edit Lesson" : "Upload Lesson"}</h2></div></div>
      {message && <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-100"><AlertCircle size={16} className="shrink-0" />{message}</div>}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <div className="space-y-4">
          <div className={`${panel} p-4`}><h3 className="mb-4 text-sm font-bold text-slate-100">Lesson details</h3><div className="grid gap-3 md:grid-cols-2"><label className="md:col-span-2"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Strategy name</span><input className={input} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="How to Identify Trend" /></label><label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Category</span><select className={input} value={draft.category} onChange={(event) => update("category", event.target.value as LessonDraft["category"])}>{LESSON_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Difficulty</span><select className={input} value={draft.difficulty} onChange={(event) => update("difficulty", event.target.value as LessonDraft["difficulty"])}>{LESSON_DIFFICULTIES.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Timeframe</span><select className={input} value={draft.timeframe} onChange={(event) => update("timeframe", event.target.value)}>{LESSON_TIMEFRAMES.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tags</span><input className={input} value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="trend, structure, confirmation" /></label><label className="md:col-span-2"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Short description</span><input className={input} value={draft.shortDescription} onChange={(event) => update("shortDescription", event.target.value)} /></label><label className="md:col-span-2"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Full lesson description</span><textarea rows={4} className={input} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label></div></div>

          <div className={`${panel} p-4`}><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-100">Original trading video</h3><p className="text-[10px] text-slate-500">MP4, WEBM, or MOV · original voice remains the default</p></div>{draft.videoPath && <CheckCircle2 size={18} className="text-emerald-300" />}</div><button className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-cyan-400/15 bg-cyan-400/[0.025] text-slate-500 transition hover:border-cyan-300/35 hover:text-cyan-200" onClick={() => videoInput.current?.click()} disabled={busy}><Upload size={28} /><span className="text-sm font-bold">{draft.videoPath ? "Replace original video" : "Choose original video"}</span><span className="text-[10px]">The video stays a video—never converted into an image.</span></button><input ref={videoInput} type="file" className="hidden" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; if (file) void processVideo(file); event.target.value = ""; }} /></div>

          {listEditor("Key Rules", draft.rules, (rules) => update("rules", rules), makeRule)}
          {listEditor("Entry Checklist", draft.checklist, (checklist) => update("checklist", checklist), makeChecklistItem)}
          {listEditor("Synced Captions", draft.captions, (captions) => update("captions", captions), makeCaption, true)}
        </div>

        <div className="space-y-4">
          <div className={`${panel} p-4`}><h3 className="text-sm font-bold text-slate-100">Processing</h3><div className="mt-4 space-y-3">{stages.map((stage, index) => { const percent = index === 0 && stage.status === "active" ? uploadPercent : stage.status === "done" || stage.status === "error" ? 100 : stage.status === "active" ? 55 : 0; return <div key={stage.label}><div className="mb-1.5 flex items-center justify-between text-[11px]"><span className={stage.status === "active" ? "text-cyan-200" : stage.status === "done" ? "text-emerald-300" : stage.status === "error" ? "text-rose-300" : "text-slate-500"}>{stage.label}</span>{stage.status === "active" ? <span className="flex items-center gap-1.5 text-cyan-300">{index === 0 ? `${Math.round(uploadPercent)}%` : null}<Loader2 size={13} className="animate-spin" /></span> : stage.status === "done" ? <Check size={13} className="text-emerald-300" /> : stage.status === "error" ? <X size={13} className="text-rose-300" /> : <span className="text-slate-700">{index + 1}</span>}</div><div className="h-1 overflow-hidden rounded-full bg-white/5"><div className={`h-full transition-all duration-300 ${stage.status === "error" ? "bg-rose-400" : "bg-gradient-to-r from-cyan-400 to-violet-400"}`} style={{ width: `${percent}%` }} /></div></div>; })}</div></div>

          <div className={`${panel} p-4`}><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-100">Thumbnail</h3><p className="text-[10px] text-slate-500">Generated from the video, or upload your own.</p></div><ImagePlus size={18} className="text-violet-300" /></div><button className={button} onClick={() => thumbInput.current?.click()} disabled={busy}><ImagePlus size={14} /> {draft.thumbnailPath ? "Change thumbnail" : "Upload custom thumbnail"}</button><input ref={thumbInput} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadThumbnail(file); event.target.value = ""; }} /></div>

          <div className={`${panel} p-4`}><h3 className="text-sm font-bold text-slate-100">Dashboard placement</h3><div className="mt-3 space-y-2">{DASHBOARD_PLACEMENTS.map((placement) => <label key={placement.value} className="flex cursor-pointer items-center justify-between rounded-xl border border-white/8 bg-black/10 px-3 py-2.5 text-xs text-slate-300"><span>{placement.label}</span><input type="checkbox" checked={draft.placements.includes(placement.value)} onChange={(event) => update("placements", event.target.checked ? [...draft.placements, placement.value] : draft.placements.filter((value) => value !== placement.value))} className="accent-cyan-400" /></label>)}</div></div>

          <div className={`${panel} p-4`}><h3 className="text-sm font-bold text-slate-100">Publishing</h3><div className="mt-3 space-y-2">{[["Published", "published"], ["Featured", "featured"], ["Autoplay muted", "autoplay"], ["Captions enabled", "captionsEnabled"]].map(([label, key]) => <label key={key} className="flex items-center justify-between rounded-xl border border-white/8 px-3 py-2.5 text-xs text-slate-300"><span>{label}</span><input type="checkbox" checked={Boolean(draft[key as keyof LessonDraft])} onChange={(event) => update(key as keyof LessonDraft, event.target.checked as never)} className="accent-cyan-400" /></label>)}</div></div>
        </div>
      </div>

      <div className="sticky bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 flex items-center justify-end gap-2 rounded-2xl border border-white/10 bg-[#07101f]/95 p-3 shadow-2xl backdrop-blur-xl"><button className={button} onClick={() => busy && uploadController.current ? uploadController.current.abort() : onCancel()}>{busy && uploadController.current ? "Cancel upload" : "Cancel"}</button><button className={primaryButton} onClick={() => void save()} disabled={busy || !draft.videoPath || !draft.title.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save Lesson</button></div>
    </div>
  );
}

export function VideoLearningHub({ onOpenLesson }: { onOpenLesson: (id: string) => void }) {
  const learning = useVideoLearning();
  const [view, setView] = useState<"library" | "manager" | "editor">("library");
  const [editing, setEditing] = useState<VideoLesson | undefined>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [message, setMessage] = useState<string | null>(null);

  if (view === "editor") return <LessonEditor initial={editing} onCancel={() => setView("manager")} onSaved={() => { setView("manager"); setEditing(undefined); void learning.reload(); }} />;

  const filtered = learning.lessons.filter((lesson) => {
    const term = query.trim().toLowerCase();
    const matches = !term || [lesson.title, lesson.category, lesson.timeframe, lesson.difficulty, ...lesson.tags].join(" ").toLowerCase().includes(term);
    return matches && (category === "All" || lesson.category === category || lesson.difficulty === category);
  });
  const managedLessons = learning.lessons.filter((lesson) => lesson.ownerId === learning.userId);

  const duplicateLesson = async (lesson: VideoLesson) => {
    setMessage(null);
    try {
      const draft = createDraft(lesson);
      draft.id = crypto.randomUUID(); draft.title = `${lesson.title} — Copy`; draft.slug = `${lesson.slug}-copy-${Date.now()}`; draft.published = false; draft.featured = false;
      draft.captions = lesson.captions.map((caption) => ({ ...caption, id: crypto.randomUUID() }));
      draft.rules = lesson.rules.map((rule) => ({ ...rule, id: crypto.randomUUID() }));
      draft.checklist = lesson.checklist.map((item) => ({ ...item, id: crypto.randomUUID() }));
      await saveVideoLesson(draft); await learning.reload(); setMessage("Lesson duplicated as a draft.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Lesson could not be duplicated."); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300">Learn · Strategy Cinema</div><h2 className="mt-1 text-xl font-black text-white">Trading Video Lessons</h2><p className="mt-1 text-xs text-slate-500">Original videos, live lyrics, key rules, and progress in one learning system.</p></div><div className="flex gap-2">{learning.canManage && <button className={button} onClick={() => setView(view === "manager" ? "library" : "manager")}><Settings2 size={15} /> {view === "manager" ? "View Library" : "My Videos"}</button>}{learning.canManage && <button className={primaryButton} onClick={() => { setEditing(undefined); setView("editor"); }}><Upload size={15} /> Upload Lesson</button>}</div></div>
      {message && <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3 text-xs text-cyan-100">{message}</div>}
      {learning.error && <EmptyLearning canManage={learning.canManage} error={learning.error} onManage={() => { setEditing(undefined); setView("editor"); }} />}

      {!learning.error && view === "library" && <>
        <div className="sticky top-0 z-20 grid gap-2 rounded-2xl border border-white/10 bg-[#050914]/90 p-2 backdrop-blur-xl sm:grid-cols-[1fr_auto]"><label className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#07101f] px-3"><Search size={15} className="text-slate-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600" placeholder="Search strategies, setups or concepts…" /></label><div className="flex gap-2 overflow-x-auto">{["All", "Beginner", "Advanced", ...LESSON_CATEGORIES].map((value) => <button key={value} onClick={() => setCategory(value)} className={`${button} whitespace-nowrap ${category === value ? "border-cyan-300/40 text-cyan-200" : ""}`}>{value}</button>)}</div></div>
        {learning.loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><LoadingCard /><LoadingCard /><LoadingCard /></div> : filtered.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((lesson) => <StrategyCard key={lesson.id} lesson={lesson} progress={learning.progress[lesson.id]} saved={learning.savedIds.includes(lesson.id)} onOpen={() => onOpenLesson(lesson.id)} onSave={() => void learning.toggleSaved(lesson.id)} />)}</div> : <EmptyLearning canManage={learning.canManage} onManage={() => { setEditing(undefined); setView("editor"); }} />}
      </>}

      {!learning.error && view === "manager" && <div className="space-y-3">{managedLessons.length === 0 ? <EmptyLearning canManage onManage={() => { setEditing(undefined); setView("editor"); }} /> : managedLessons.map((lesson) => <div key={lesson.id} className={`${panel} flex flex-col gap-3 p-3 sm:flex-row sm:items-center`}><div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-black/20"><Film size={22} className="text-cyan-400/40" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-100">{lesson.title}</h3><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${lesson.published ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-700/40 text-slate-400"}`}>{lesson.published ? "Published" : "Draft"}</span>{lesson.featured && <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[9px] font-bold text-cyan-300">Featured</span>}<span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${lesson.storageProvider === "cloudflare_r2" ? "bg-blue-400/10 text-blue-300" : "bg-amber-400/10 text-amber-300"}`}>{lesson.storageProvider === "cloudflare_r2" ? `R2 · ${lesson.uploadStatus}` : "Supabase media"}</span></div><p className="mt-1 text-[10px] text-slate-500">{lesson.category} · {lesson.difficulty} · {formatTime(lesson.duration)} · {lesson.videoSizeBytes ? `${(lesson.videoSizeBytes / 1024 / 1024).toFixed(1)} MB · ` : ""}Updated {new Date(lesson.updatedAt).toLocaleDateString()}</p><p className="mt-1 text-[10px] text-slate-600">{lesson.placements.map((value) => DASHBOARD_PLACEMENTS.find((placement) => placement.value === value)?.label).filter(Boolean).join(" · ") || "No placement"}</p></div></div><div className="flex flex-wrap gap-2"><button className={button} onClick={() => onOpenLesson(lesson.id)}><Play size={14} /> View</button><button className={button} onClick={() => { setEditing(lesson); setView("editor"); }}><Pencil size={14} /> Edit</button><button className={button} onClick={() => void duplicateLesson(lesson)}><Copy size={14} /> Duplicate</button><button className={`${button} hover:text-rose-300`} onClick={async () => { if (!confirm(`Delete “${lesson.title}” and its media?`)) return; try { await deleteVideoLesson(lesson); await learning.reload(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Delete failed."); } }}><Trash2 size={14} /></button></div></div>)}</div>}
    </div>
  );
}

export function VideoLessonPage({ lessonId, onBack }: { lessonId: string; onBack: () => void }) {
  const learning = useVideoLearning();
  const lesson = learning.lessons.find((item) => item.id === lessonId);
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  if (learning.loading) return <div className="mx-auto max-w-6xl"><LoadingCard /></div>;
  if (!lesson) return <div className="mx-auto max-w-2xl"><EmptyLearning canManage={learning.canManage} error={learning.error || "This lesson is unavailable or has not been published."} /><button className={`${button} mt-3`} onClick={onBack}><ArrowLeft size={15} /> Back to Learn</button></div>;

  const progress = learning.progress[lesson.id];
  const related = learning.lessons.filter((item) => item.id !== lesson.id && item.published && (item.category === lesson.category || item.tags.some((tag) => lesson.tags.includes(tag)))).slice(0, 3);
  const updateChecklist = (itemId: string, checked: boolean) => learning.updateProgress(lesson.id, { checklistState: { ...(progress?.checklistState || {}), [itemId]: checked } }, true);

  return (
    <main className="mx-auto max-w-6xl space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3"><button className={button} onClick={onBack}><ArrowLeft size={15} /> Back to Learn</button><div className="text-right"><div className="text-[9px] font-black uppercase tracking-[0.22em] text-cyan-300">{lesson.category}</div><div className="mt-1 text-[10px] text-slate-500">Lesson progress {Math.round(progress?.percentage || 0)}%</div></div></div>
      <div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold text-cyan-200">{lesson.difficulty}</span><span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold text-violet-200">{lesson.timeframe}</span></div><h1 className="mt-3 text-2xl font-black text-white md:text-4xl">{lesson.title}</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{lesson.description || lesson.shortDescription}</p></div>
      <VideoLessonPlayer lesson={lesson} progress={progress} saved={learning.savedIds.includes(lesson.id)} onProgress={(patch, immediate) => learning.updateProgress(lesson.id, patch, immediate)} onToggleSaved={() => void learning.toggleSaved(lesson.id)} />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-4">
          <section className={`${panel} overflow-hidden`}><button onClick={() => setTranscriptOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left"><div><h2 className="text-sm font-black text-slate-100">Live Lyrics & Transcript</h2><p className="text-[10px] text-slate-500">Timestamped phrases from the original voice</p></div><span className="text-xs text-cyan-300">{transcriptOpen ? "Hide" : "Show"}</span></button>{transcriptOpen && <div className="max-h-96 space-y-2 overflow-y-auto border-t border-white/5 p-3">{lesson.captions.length ? lesson.captions.map((caption) => <div key={caption.id} className="grid grid-cols-[54px_1fr] gap-3 rounded-xl border border-white/5 bg-black/10 p-3"><span className="text-[10px] font-bold text-cyan-300">{formatTime(caption.startTime)}</span><p className="text-xs leading-relaxed text-slate-300">{caption.text}</p></div>) : <p className="p-4 text-center text-xs text-slate-600">No transcript has been added yet.</p>}</div>}</section>
          <section className={`${panel} p-4`}><h2 className="text-sm font-black text-slate-100">Personal Notes</h2><textarea value={progress?.notes || ""} onChange={(event) => learning.updateProgress(lesson.id, { notes: event.target.value })} onBlur={(event) => learning.updateProgress(lesson.id, { notes: event.target.value }, true)} rows={5} className={`${input} mt-3`} placeholder="Capture what you noticed in the chart…" /></section>
        </div>
        <div className="space-y-4">
          <section className={`${panel} p-4`}><div className="flex items-center justify-between"><h2 className="text-sm font-black text-slate-100">Key Rules</h2><Sparkles size={16} className="text-cyan-300" /></div><ol className="mt-3 space-y-2">{lesson.rules.map((rule, index) => <li key={rule.id} className="flex gap-3 rounded-xl border border-white/5 bg-black/10 p-3 text-xs leading-relaxed text-slate-300"><span className="font-black text-cyan-300">{index + 1}</span>{rule.text}</li>)}</ol></section>
          <section className={`${panel} p-4`}><h2 className="text-sm font-black text-slate-100">Entry Checklist</h2><div className="mt-3 space-y-2">{lesson.checklist.map((item) => <label key={item.id} className="flex cursor-pointer gap-3 rounded-xl border border-white/5 bg-black/10 p-3 text-xs text-slate-300"><input type="checkbox" checked={Boolean(progress?.checklistState?.[item.id])} onChange={(event) => updateChecklist(item.id, event.target.checked)} className="mt-0.5 accent-cyan-400" /><span>{item.text}</span></label>)}</div></section>
          <section className={`${panel} p-4`}><div className="flex items-center justify-between"><div><h2 className="text-sm font-black text-slate-100">Lesson Progress</h2><p className="mt-1 text-[10px] text-slate-500">Continue from {formatTime(progress?.watchedSeconds || 0)}</p></div><span className="text-lg font-black text-cyan-300">{Math.round(progress?.percentage || 0)}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" style={{ width: `${progress?.percentage || 0}%` }} /></div><button className={`${button} mt-3 w-full`} onClick={() => learning.updateProgress(lesson.id, { completed: !progress?.completed, percentage: progress?.completed ? progress.percentage : 100 }, true)}>{progress?.completed ? "Mark incomplete" : "Mark lesson complete"}</button></section>
        </div>
      </div>

      {related.length > 0 && <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black text-slate-100">Related Lessons</h2><span className="text-[10px] text-slate-500">Keep building the concept</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{related.map((item) => <StrategyCard key={item.id} lesson={item} progress={learning.progress[item.id]} saved={learning.savedIds.includes(item.id)} onOpen={() => { window.history.pushState({}, "", `/learn/strategy/${item.id}`); window.dispatchEvent(new PopStateEvent("popstate")); }} onSave={() => void learning.toggleSaved(item.id)} />)}</div></section>}
    </main>
  );
}
