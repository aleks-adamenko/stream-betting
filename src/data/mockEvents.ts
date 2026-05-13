import type { Influencer, StreamEvent } from "@/domain/types";

import balloonsCover from "@/assets/01-challenge-balloons.jpg";
import eggsDropCover from "@/assets/02-challenge-eggs-drop.jpg";
import blindedWaterCover from "@/assets/03-challenge-blinded-water.jpg";
import bowlsCover from "@/assets/04-challenge-bowls.jpg";
import oneSentenceCover from "@/assets/05-challenge-one-sentence.jpg";
import cardsTowerCover from "@/assets/06-challenge-cards-tower.jpg";

const influencers: Influencer[] = [
  {
    id: "inf_vibe",
    handle: "@vibe.queen778",
    displayName: "Vibe Queen",
    avatarUrl:
      "https://images.unsplash.com/photo-1517022812141-23620dba5c23?auto=format&fit=crop&w=200&q=80",
    followers: 1_482_000,
    socials: { tiktok: "https://tiktok.com/", instagram: "https://instagram.com/" },
  },
  {
    id: "inf_smily",
    handle: "@thesmilyfam",
    displayName: "The Smily Fam",
    avatarUrl:
      "https://images.unsplash.com/photo-1542596594-649edbc13630?auto=format&fit=crop&w=200&q=80",
    followers: 2_310_000,
    socials: { youtube: "https://youtube.com/", instagram: "https://instagram.com/" },
  },
  {
    id: "inf_mochi",
    handle: "@midnight.mochi",
    displayName: "Midnight Mochi",
    avatarUrl:
      "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=200&q=80",
    followers: 612_000,
    socials: { tiktok: "https://tiktok.com/" },
  },
  {
    id: "inf_angelo",
    handle: "@_angelomaras",
    displayName: "Angelo Maras",
    avatarUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80",
    followers: 894_000,
    socials: { tiktok: "https://tiktok.com/", x: "https://x.com/" },
  },
  {
    id: "inf_stunt",
    handle: "@stunt.boys.live",
    displayName: "Stunt Boys",
    avatarUrl:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80",
    followers: 1_120_000,
    socials: { youtube: "https://youtube.com/", instagram: "https://instagram.com/" },
  },
  {
    id: "inf_daily",
    handle: "@daily.dares",
    displayName: "Daily Dares",
    avatarUrl:
      "https://images.unsplash.com/photo-1488161628813-04466f872be2?auto=format&fit=crop&w=200&q=80",
    followers: 438_000,
    socials: { tiktok: "https://tiktok.com/", instagram: "https://instagram.com/" },
  },
  {
    id: "inf_kim",
    handle: "@kim.tries",
    displayName: "Kim Tries",
    avatarUrl:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80",
    followers: 281_000,
    socials: { instagram: "https://instagram.com/" },
  },
  {
    id: "inf_grandpa",
    handle: "@grandpa.ranks",
    displayName: "Grandpa Ranks",
    avatarUrl:
      "https://images.unsplash.com/photo-1559548331-f9cb98001426?auto=format&fit=crop&w=200&q=80",
    followers: 706_000,
    socials: { tiktok: "https://tiktok.com/", youtube: "https://youtube.com/" },
  },
];

export const mockEvents: StreamEvent[] = [
  {
    id: "evt_blindfold_cup",
    title: "Filling cups blindfolded… this got ugly fast 😭",
    description:
      "Two pairs, blindfolds on, jugs of water in hand. First to fill the cup without spilling wins.",
    coverUrl: blindedWaterCover,
    status: "live",
    category: "Challenges",
    rules:
      "Each team has one pourer (blindfolded) and one guide (no touching the pourer). First team to fill the 500ml cup to the line wins. Spills don't count toward the line.",
    roundFormat: "event",
    scheduledAt: new Date(Date.now() - 22 * 60_000).toISOString(),
    startedAt: new Date(Date.now() - 22 * 60_000).toISOString(),
    viewersCount: 14_280,
    influencer: influencers[0],
    outcomes: [
      { id: "o1", label: "Team Sky finishes first", odds: 1.95 },
      { id: "o2", label: "Team Mango finishes first", odds: 2.1 },
      { id: "o3", label: "Both teams spill out", odds: 6.5 },
    ],
    totalPool: 38_420,
  },
  {
    id: "evt_balloon_box",
    title: "Don't Pop The Balloon Challenge 🎈",
    description:
      "Twelve balloons crammed in a box. Pull the strings, dodge the pop, only one survivor in this round.",
    coverUrl: balloonsCover,
    status: "live",
    category: "Challenges",
    rules:
      "Players take turns pulling one string per round. If the balloon pops, that player is out. Last player standing without popping a balloon wins the round.",
    roundFormat: "event",
    scheduledAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    startedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    viewersCount: 42_106,
    influencer: influencers[1],
    outcomes: [
      { id: "o1", label: "Leo survives", odds: 2.4 },
      { id: "o2", label: "Sara survives", odds: 2.2 },
      { id: "o3", label: "Mike survives", odds: 3.0 },
      { id: "o4", label: "Box empties first", odds: 12 },
    ],
    totalPool: 92_640,
  },
  {
    id: "evt_spicy_ramen",
    title: "She made it to tier 5… my mouth didn't 🌶️🔥",
    description:
      "Five bowls. Five heat levels. Get to level 5 without milk, and you win the round.",
    coverUrl: bowlsCover,
    status: "live",
    category: "Food",
    rules:
      "Players eat one full bowl per heat tier. Asking for milk is forfeit. First to finish tier 5 wins. If everyone forfeits, the bowl with the most spoons wins.",
    roundFormat: "time",
    roundDurationSec: 240,
    scheduledAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    viewersCount: 7_842,
    influencer: influencers[2],
    outcomes: [
      { id: "o1", label: "Mochi reaches tier 5", odds: 1.8 },
      { id: "o2", label: "Yumi reaches tier 5", odds: 2.6 },
      { id: "o3", label: "Both forfeit", odds: 4.4 },
    ],
    totalPool: 19_310,
  },
  {
    id: "evt_try_not_laugh",
    title: "He tried not to laugh… but the meme broke him 😂",
    description:
      "Three friends. One folder of cursed memes. Crack a smile, lose your seat.",
    coverUrl:
      "https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=900&q=80",
    status: "scheduled",
    category: "Comedy",
    rules:
      "Each round one player reads three memes aloud to the others. Any visible laugh or smile costs a life. First player to lose all three lives forfeits the round.",
    roundFormat: "event",
    scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    viewersCount: 612,
    influencer: influencers[3],
    outcomes: [
      { id: "o1", label: "Diego cracks first", odds: 2.0 },
      { id: "o2", label: "Maya cracks first", odds: 2.5 },
      { id: "o3", label: "Pat cracks first", odds: 2.2 },
      { id: "o4", label: "Nobody breaks", odds: 9.0 },
    ],
    totalPool: 0,
  },
  {
    id: "evt_egg_drop",
    title: "Dropped an egg from the 4th floor… yolk is praying 🥚",
    description:
      "Three engineering hopefuls. Three containers. Will the yolk survive a four-story drop?",
    coverUrl: eggsDropCover,
    status: "scheduled",
    category: "Skills",
    rules:
      "Each contestant builds a protective container with the same kit. Drop from the 4th floor balcony. Winner: egg intact + smallest container by volume.",
    roundFormat: "event",
    scheduledAt: new Date(Date.now() + 21 * 3600_000).toISOString(),
    viewersCount: 0,
    influencer: influencers[4],
    outcomes: [
      { id: "o1", label: "Red container survives", odds: 1.9 },
      { id: "o2", label: "Blue container survives", odds: 2.3 },
      { id: "o3", label: "Green container survives", odds: 2.1 },
      { id: "o4", label: "All three crack", odds: 5.5 },
    ],
    totalPool: 0,
  },
  {
    id: "evt_whisper_chain",
    title: "7 strangers, 1 sentence, absolute chaos 🎧",
    description:
      "Seven strangers, headphones on white noise, one sentence travels the line. What comes out the other side?",
    coverUrl: oneSentenceCover,
    status: "scheduled",
    category: "Comedy",
    rules:
      "Phrase passed through 7 people wearing noise-cancelling headphones. Round winner: closest end-of-chain reproduction to the original phrase, judged by audience vote.",
    roundFormat: "event",
    scheduledAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
    viewersCount: 0,
    influencer: influencers[5],
    outcomes: [
      { id: "o1", label: "Phrase survives ≥80%", odds: 4.8 },
      { id: "o2", label: "Phrase 40-79% intact", odds: 2.1 },
      { id: "o3", label: "Phrase <40%", odds: 1.7 },
    ],
    totalPool: 0,
  },
  {
    id: "evt_card_tower",
    title: "90 seconds to build the tallest card tower ⏱️",
    description:
      "Two builders. 90 seconds. Tallest free-standing card tower takes the round.",
    coverUrl: cardsTowerCover,
    status: "finished",
    category: "Skills",
    rules:
      "Each builder has 90 seconds and a fresh deck. Tower must stand on its own for 5 seconds after the timer. Tallest wins. Collapse = forfeit.",
    roundFormat: "time",
    roundDurationSec: 90,
    scheduledAt: new Date(Date.now() - 1 * 24 * 3600_000).toISOString(),
    viewersCount: 0,
    influencer: influencers[6],
    outcomes: [
      { id: "o1", label: "Kim wins", odds: 1.8 },
      { id: "o2", label: "Ravi wins", odds: 2.0 },
      { id: "o3", label: "Both collapse", odds: 5.0 },
    ],
    totalPool: 12_840,
  },
  {
    id: "evt_hot_sauce_roulette",
    title: "One of these wings has Carolina Reaper… good luck 🔥",
    description:
      "Six identical wings. One is dipped in the world's hottest sauce. Pick one. Smile.",
    coverUrl:
      "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=900&q=80",
    status: "finished",
    category: "Food",
    rules:
      "Six wings on a plate. One brushed with Carolina Reaper extract. Players take turns picking and eating one wing without sniffing. Player who gets the spicy wing loses.",
    roundFormat: "event",
    scheduledAt: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
    viewersCount: 0,
    influencer: influencers[7],
    outcomes: [
      { id: "o1", label: "Pat gets the wing", odds: 2.4 },
      { id: "o2", label: "Lina gets the wing", odds: 2.4 },
      { id: "o3", label: "Marc gets the wing", odds: 2.4 },
    ],
    totalPool: 27_490,
  },
];

export function getLiveEvents() {
  return mockEvents.filter((e) => e.status === "live");
}

export function getScheduledEvents() {
  return mockEvents.filter((e) => e.status === "scheduled");
}

export function getEventById(id: string) {
  return mockEvents.find((e) => e.id === id);
}
