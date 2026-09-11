import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Flame,
  Radio,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "../components/ui/carousel";
import {
  demoInsights,
  price,
  setupPath,
  type InsightPreview,
} from "./demo-data";
import {
  AIScoreBadge,
  AIStatusBadge,
  DemoLabel,
  KeyValue,
  OnkarAIEntryButton,
} from "./ui";
import { MiniMarketChart } from "./charts";
import "./onkar-ai.css";
type Props = {
  onNavigate: (path: string) => void;
  insights?: InsightPreview[];
};
export function AIInsightCard({
  insight,
  onNavigate,
}: {
  insight: InsightPreview;
  onNavigate: Props["onNavigate"];
}) {
  const { kind, setup } = insight;
  const labels = {
    setup: "TOP OPPORTUNITY",
    entry: "ENTRY APPROACHING",
    news: "MARKET WARNING",
    developing: "SETUP DEVELOPING",
    invalidated: "SETUP INVALIDATED",
    performance: "PERFORMANCE INSIGHT",
  };
  const destination =
    kind === "news"
      ? "/onkar-ai/news"
      : kind === "performance"
        ? "/onkar-ai/analytics"
        : setupPath(setup!.id);
  return (
    <button
      type="button"
      onClick={() => onNavigate(destination)}
      className={`oai-insight-card oai-insight-${kind}`}
    >
      <div className="oai-insight-kicker">
        {kind === "news" ? (
          <ShieldAlert size={15} />
        ) : kind === "performance" ? (
          <TrendingUp size={15} />
        ) : kind === "setup" ? (
          <Flame size={15} />
        ) : (
          <Radio size={15} />
        )}
        <span>{labels[kind]}</span>
        <ArrowUpRight size={15} />
      </div>
      {setup ? (
        <>
          <div className="oai-insight-title">
            <div>
              <h3>{setup.symbol}</h3>
              <p>{setup.name}</p>
            </div>
            <AIScoreBadge score={setup.score} large />
          </div>
          <div className="oai-row">
            <AIStatusBadge status={setup.direction} />
            <span className="oai-muted">
              {setup.timeframe} · HTF{" "}
              {setup.direction === "Long" ? "bullish" : "bearish"}
            </span>
          </div>
          <MiniMarketChart setup={setup} />
          <div className="oai-insight-values">
            <KeyValue
              label="Entry zone"
              value={`${price(setup.entry[0])} – ${price(setup.entry[1])}`}
            />
            <KeyValue label="R : R" value={`1 : ${setup.rr}`} />
            <KeyValue label="Stop loss" value={price(setup.stop)} />
            <KeyValue label="Target 1" value={price(setup.targets[0])} />
          </div>
          <p className="oai-insight-note">
            {kind === "invalidated"
              ? "Sample: price closed below support."
              : kind === "developing"
                ? "Waiting for a confirmation candle."
                : kind === "entry"
                  ? "Price approaching the planned entry zone."
                  : `${setup.rules}/10 rules matched · Review risk before entry.`}
          </p>
        </>
      ) : kind === "news" ? (
        <>
          <h3>US CPI</h3>
          <p className="oai-muted">USD pairs · High-impact event</p>
          <div className="oai-warning-time">
            <ShieldAlert size={30} />
            <strong>
              18<small>minutes away</small>
            </strong>
          </div>
          <p className="oai-insight-note">
            Sample event timeline. Reassess USD exposure and wait for volatility
            to settle.
          </p>
          <AIStatusBadge status="Waiting for news" />
        </>
      ) : (
        <>
          <h3>
            Your process.
            <br />
            Your edge.
          </h3>
          <p className="oai-muted">Sample journal insight</p>
          <div className="oai-insight-stat">
            <strong>60%</strong>
            <span>win rate across 5 example trades</span>
          </div>
          <p className="oai-insight-note">
            Compare your strongest setups, recurring mistakes and session
            performance.
          </p>
          <div className="oai-row">
            <KeyValue label="Average result" value="+0.88R" />
            <KeyValue label="Profit factor" value="3.2" />
          </div>
        </>
      )}
      <footer>
        <span>
          {kind === "news"
            ? "View calendar"
            : kind === "performance"
              ? "Explore analytics"
              : kind === "invalidated"
                ? "Review setup"
                : "View analysis"}
        </span>
        <ArrowRight size={16} />
      </footer>
    </button>
  );
}
export function OnkarAIRecentSlider({
  onNavigate,
  insights = demoInsights,
}: Props) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!api) return;
    const sync = () => {
      setIndex(api.selectedScrollSnap());
      setCount(api.scrollSnapList().length);
    };
    sync();
    api.on("select", sync);
    api.on("reInit", sync);
    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);
  const sorted = [...insights].sort((a, b) => a.priority - b.priority);
  return (
    <section
      className="oai oai-recent"
      aria-label="Onkar AI recent intelligence preview"
    >
      <header className="oai-recent-header">
        <div className="oai-row">
          <span className="oai-brand-icon">
            <BrainCircuit size={25} />
          </span>
          <div>
            <span className="oai-eyebrow">ONKAR AI</span>
            <h2>Recent Intelligence</h2>
            <p>Important market analysis, setups and alerts</p>
          </div>
        </div>
        <div className="oai-recent-actions">
          <DemoLabel />
          <button
            className="oai-text-button"
            onClick={() => onNavigate("/onkar-ai")}
          >
            View all <ArrowUpRight size={16} />
          </button>
        </div>
      </header>
      <Carousel
        opts={{ align: "start", dragFree: false, containScroll: "trimSnaps" }}
        setApi={setApi}
        className="oai-intelligence-carousel"
      >
        <CarouselContent>
          {sorted.map((insight) => (
            <CarouselItem key={insight.id} className="oai-slide">
              <AIInsightCard insight={insight} onNavigate={onNavigate} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
      <footer className="oai-slider-footer">
        <div className="oai-row">
          <button
            aria-label="Previous intelligence cards"
            className="oai-icon-button"
            disabled={!api?.canScrollPrev()}
            onClick={() => api?.scrollPrev()}
          >
            <ChevronLeft size={18} />
          </button>
          <div className="oai-dots">
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                aria-label={`Go to intelligence page ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                className={i === index ? "active" : ""}
                onClick={() => api?.scrollTo(i)}
              />
            ))}
          </div>
          <button
            aria-label="Next intelligence cards"
            className="oai-icon-button"
            disabled={!api?.canScrollNext()}
            onClick={() => api?.scrollNext()}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <OnkarAIEntryButton compact onClick={() => onNavigate("/onkar-ai")} />
      </footer>
    </section>
  );
}
