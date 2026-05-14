import { PageContainer } from "@/components/layout/PageContainer";
import rushPhoto from "@/assets/rush.jpg";
import queenPhoto from "@/assets/queen.jpg";
import statzPhoto from "@/assets/statz.jpg";
import vibePhoto from "@/assets/Vibe.jpg";

interface Founder {
  nickname: string;
  bio: string;
  photoUrl: string;
}

const FOUNDERS: Founder[] = [
  {
    nickname: "Spark",
    bio: "Live moments bring people together faster than anything else. We're building experiences that turn fun into real connection.",
    photoUrl: rushPhoto,
  },
  {
    nickname: "Chaos Queen",
    bio: "The best products feel alive. A little chaos, a little competition, and suddenly strangers are laughing together like friends.",
    photoUrl: queenPhoto,
  },
  {
    nickname: "Leo",
    bio: "I love building systems that make energy spread worldwide in seconds.",
    photoUrl: statzPhoto,
  },
  {
    nickname: "Zoe “Good Vibes”",
    bio: "Happiness is contagious. When people share fun experiences together, communities grow stronger, kinder, and more human.",
    photoUrl: vibePhoto,
  },
];

export default function Company() {
  return (
    <PageContainer className="lg:pt-24">
      <div className="lg:px-[194px]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
          Our manifest
        </p>
        <h1
          className="mt-3 text-[42px] italic uppercase leading-[48px] tracking-tight text-foreground sm:text-[54px] sm:leading-[1.05] lg:text-[70px]"
          style={{ fontFamily: "'Inter', sans-serif", fontWeight: 900 }}
        >
          We turn every stream into a{" "}
          <span className="relative inline-block">
            <span className="text-primary">win</span>
            <svg
              aria-hidden
              viewBox="0 0 120 16"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-x-0 -bottom-2 h-3 w-full sm:-bottom-3 sm:h-4"
            >
              <path
                d="M3 9 Q 30 14, 60 8 T 117 9"
                stroke="#FED448"
                strokeWidth="6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </span>{" "}
          for everyone.
        </h1>

        <div className="mt-[22px] max-w-2xl space-y-1 text-sm text-muted-foreground sm:text-base">
          <p>LiveRush is built for the bold, the playful, and the competitive.</p>
          <p>We believe live is better. Together is stronger.</p>
          <p>And everyone should have a shot to win.</p>
        </div>
      </div>

      <div className="mt-[38px] grid grid-cols-2 gap-4 lg:grid-cols-4 lg:px-12">
        {FOUNDERS.map((f) => (
          <FounderCard key={f.name} founder={f} />
        ))}
      </div>
    </PageContainer>
  );
}

function FounderCard({ founder }: { founder: Founder }) {
  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-xl"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-b from-[#A78BFA] to-[#7C6BFF]">
        <img
          src={founder.photoUrl}
          alt={founder.nickname}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-heading text-lg font-bold text-foreground">
          {founder.nickname}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {founder.bio}
        </p>
      </div>
    </article>
  );
}
