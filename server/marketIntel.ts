/**
 * Market Intelligence Aggregator
 *
 * Pulls broad market signals from free, no-auth sources:
 *   - Reddit: r/wallstreetbets, r/pennystocks, r/stocks (JSON API)
 *   - RSS: MarketWatch, Yahoo Finance
 *   - SEC Edgar: Form 4 insider-buying filings (ATOM feed)
 *
 * Extracts ticker mentions, scores buzz, and exposes results for
 * AI discovery and the frontend Market Buzz panel.
 */

import { addAutoTradeLog } from "./autoTrader";
import { storage } from "./storage";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface MarketBuzzItem {
  ticker: string;
  mentionCount: number;
  sources: Array<"reddit" | "rss" | "sec">;
  headlines: string[];
  sentiment: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MarketIntelScanResult {
  scannedAt: string;
  totalMentions: number;
  topTickers: MarketBuzzItem[];
  sourceStatus: {
    reddit: "ok" | "error" | "skipped";
    rss: "ok" | "error" | "skipped";
    sec: "ok" | "error" | "skipped";
  };
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const MARKET_INTEL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_TTL_MS = 30 * 60 * 1000;             // 30 minutes
const FETCH_TIMEOUT_MS = 8_000;
const MIN_MENTIONS = 3;                           // require ≥3 score to surface ticker
const USER_AGENT = "MarketIntelBot/1.0 (stock-trading-bot; contact@localhost)";

// Words that look like tickers but are not
const TICKER_BLOCKLIST = new Set([
  // 2-letter noise (capitalized in headlines but not tickers)
  "US","UK","EU","UN","AI","IS","IN","ON","AT","BY","IF","AS","DO","GO","NO","OR",
  "TO","OF","UP","AN","BE","IT","SO","VS","EX","AM","PM","TV","OK","HR","ID",
  "ES","CL","WS","FX","PE","VC","ML","AI","NI","LI","HE","SH","NG",
  "TL","DR","EV","ER","JV","LP","GP","PP","II","IV","IX","XI","XX",
  // Common English words (3-letter)
  "THE","AND","FOR","ARE","BUT","NOT","YOU","ALL","CAN","HER","WAS","ONE","OUR",
  "OUT","DAY","GET","HAS","HIM","HIS","HOW","ITS","MAY","NEW","NOW","OLD","SEE",
  "TWO","WHO","DID","LET","MAN","PUT","SAY","SHE","TOO","USE","WAY","BIG","BOT",
  "DIP","DUE","END","FAR","FEW","GOT","HAD","HIT","HOT","KEY","LOW","MID","NET",
  "OFF","OWN","PAY","PER","PRE","PRO","RAW","RUN","SET","SUM","TAX","TOP","TRY",
  "VIA","WIN","YET","YOY","ZAP","INC","LLC","LTD","PLC","COR","REF","AVG",
  "AGO","ASK","BID","CUT","DEC","EST","ETA","ETC","FEW","FIX","GEN",
  "JAN","JUL","JUN","LAG","LOG","LOT","MAX","MIN","MOD",
  "NOV","OCT","OPT","PCT","POC","POS","QTR","REV","RHS","RPT",
  "SEP","SRC","SUB","TOT","TRN","UPD","VAR","VOL","WKN","YLD",
  "WHY","AMP","WAR","AGO","ANY","APR","AUG","BAN","BAR","BAY","APY","WTI","LNG","GAS",
  "BIT","BIZ","CAP","COL","CON","COP","DEF","DIV","DUP","ECB","ECO",
  "EIA","ENV","ERA","ERR","FAD","FAT","FIN","FLY","FTC","GAP","GEM",
  "GIG","GNU","GOV","GPS","HPC","INF","IOT","IRA","IRR","IRS","JAB",
  "KPI","LAB","LAW","LAX","LBO","LEV","MAG","MAT","MBA","MCG","MOM",
  "MOU","MSA","MSG","NAT","NIM","NIT","NLP","NOI","NPE","NPL","NPV",
  "NRC","NSF","NTF","OFC","OOP","OSS","PAC","PAR","PAX","PHD","POP",
  "PRC","PSA","PSI","PUB","PVC","QOQ","REC","REG","REP","RES","RFI",
  "RFQ","RPG","RPI","RTB","RTF","RTI","SAL","SBA","SKU","SLA","SME",
  "SNR","SOP","SRS","SSA","SSI","STD","STR","SWF","TAM","TBF","TBT",
  "TIN","TIP","TLD","TNC","TNT","TRF","TRS","TSP","TTF","TTP","UBI",
  "UPG","VAN","VCP","VDR","VET","VPN","WAC","WAN","WAP","WCO","WEF",
  "WFH","WIP","WON","XYZ","YOD","YTD","YTM",
  // Common English words (4-letter)
  "ALSO","BACK","BEEN","BEST","BOTH","CAME","COME","DOES","DONE","EACH",
  "EVEN","EVER","FROM","GIVE","GOES","GOOD","HAVE","HERE","HIGH","INTO",
  "JUST","KEEP","KNEW","KNOW","LAST","LEFT","LIKE","LOOK","MADE","MAKE",
  "MANY","MORE","MOST","MOVE","MUCH","MUST","NEED","NEXT","NONE","ONLY",
  "OPEN","OVER","SAID","SAME","SEEN","SELF","SENT","SHOW","SIDE","SOME",
  "SOON","SUCH","TAKE","THAN","THAT","THEM","THEN","THEY","THIS","THUS",
  "TIME","TOOK","UPON","USED","VERY","WANT","WELL","WENT","WERE","WHAT",
  "WHEN","WHOM","WILL","WITH","YEAR","YOUR","ZERO","ALSO","BACK","BOTH",
  "DAYS","WEEK","WEEKS","ELSE","EVEN","GOES","GREW","HARD","HEAD","HELP","HOLD","HOME",
  "HOPE","HUGE","HURT","IDEA","LESS","LONG","LOSE","LOST","MEAN","MIND",
  "MISS","TOLD","TOLD","TRUE","TURN","TYPE","VIEW","VOTE","WAIT","WIDE",
  "WORD","WORK","ABLE","ADDS","AREA","AWAY","BASE","CASE","CITY","COST",
  "NEWS","INFO","DATA","LIVE","PLAN","IRAN","SAYS","SAID","SAYS","TOLD",
  "ALSO","BACK","INFO","RATE","MOVE","DEAL","NEXT","LAST","LIKE","GOOD",
  "IRAN","IRAQ","ASIA","EURO","LATIN","ARAB","OPEC","APAC","EMEA",
  "WEEK","YEAR","DAYS","HOUR","MINS","SECS",
  "HIGH","LOWS","TOPS","HITS","BEAT","MISS","JUMP","DROP","SLIP","RISE",
  "BOOM","BUST","HIKE","CUTS","TRIM","LIFT","SINK","SOAR","PLUM","MELT",
  "BULL","BEAR","FLAT","THIN","WIDE","FAST","SLOW","SOFT","HARD","BOLD",
  "SAYS","WINS","LOSS","GAIN","PAID","OWES","OWES","OWED","OWES","OWED",
  "DEAL","DEBT","DEEP","DOWN","DRAW","EASY","EDGE","FALL","FELL","FILE",
  "FINE","FIRE","FIVE","FLAG","FLAT","FLOW","FORM","FOUR","FREE","FULL",
  "GIVE","GOAL","GOLD","GROW","HALF","HAND","HARD","HEAR","HEAT","HELP",
  "HINT","HUGE","HUNT","JUMP","KEEP","KILL","LACK","LEAD","LIFT","LINK",
  "LIST","LIVE","LOAD","LOCK","LOOK","LOSS","LOTS","MARK","MASS","MEAL",
  "MEET","MILD","MILE","MINE","MISS","MODE","MONO","MOOD","NORM","ODDS",
  "ONES","OPEN","PAID","PART","PASS","PAST","PATH","PICK","PILE","PLAN",
  "PLAY","PLUS","POLL","POOL","POOR","PORT","POST","PULL","PUSH","READ",
  "REAL","RELY","RISE","ROAD","ROLE","ROOM","ROSE","RULE","SAFE","SALE",
  "SAVE","SELL","SEND","SIGN","SIZE","SLOW","SOLD","SORT","SPOT","STEP",
  "STOP","SURE","SWAP","TALK","TEAM","TERM","TEST","THAT","THEM","THEN",
  "THEY","THIN","TIER","TILL","TINY","TOLD","TOOL","TOPS","TOWN","TRIM",
  "UNIT","URGE","VAST","WADE","WAGE","WAKE","WARM","WARN","WASH","WAYS",
  "WIPE","WIRE","WISE","WISH","WRAP","ZONE",
  // Common English words (5-letter)
  "ABOUT","ABOVE","AFTER","AGAIN","AHEAD","AMONG","APPLY","AREAS","ARRAY",
  "ASKED","ASSET","AVOID","BASED","BEING","BELOW","BONUS","BOOST","BROKE",
  "BUILD","BUILT","BURST","CALLS","CARRY","CAUSE","CHART","CHECK","CHIEF",
  "CHINA","CHOSE","CLAIM","CLASS","CLEAN","CLEAR","CLOSE","COMES","COULD",
  "COUNT","COURT","COVER","CRASH","CROSS","DAILY","DEALS","DELAY","DOING",
  "DOUBT","DRAFT","EARLY","EIGHT","EMBED","ENDED","ENTER","EQUAL","EQUIP",
  "ERROR","EVERY","EXACT","EXIST","EXTRA","FACED","FALLS","FIFTY","FILED",
  "FINAL","FIRMS","FIXED","FOCUS","FORCE","FOREX","FORMS","FOUND","FRESH",
  "FRONT","FUNDS","GIANT","GIVEN","GOING","GRACE","GRADE","GRANT","GREAT",
  "GREEN","GROUP","GROWN","GUIDE","HEAVY","HENCE","HOLDS","HUMAN","HURTS",
  "IMAGE","IMPLY","INDEX","INDIA","INFER","INPUT","ISSUE","JAPAN","KEEPS",
  "KNOWN","LARGE","LATER","LAYER","LEADS","LEGAL","LEVEL","LIGHT","LIMIT",
  "LOCAL","LOGIC","LOWER","MACRO","MAJOR","MATCH","MEDIA","MICRO","MIGHT",
  "MODEL","MONEY","MONTH","MOVED","MOVES","MULTI","NAMES","NEVER","NOTED",
  "OCCUR","OFFER","OFTEN","ORDER","OTHER","OUGHT","OWNED","OWNER","PANEL",
  "PAPER","PARTS","PHASE","PICKS","PLACE","PLANS","POINT","POSTS","POWER",
  "PRESS","PRICE","PRIOR","PROVE","PROXY","QUITE","QUOTE","RANGE","RAPID",
  "RATES","RATIO","REACH","READY","REFER","RELAY","REPAY","RESET","RIGHT",
  "RISES","RISKS","ROUGH","ROUND","ROUTE","RULES","SALES","SCALE","SCORE",
  "SEVEN","SHARE","SHIFT","SHORT","SHOWS","SINCE","SITES","SIXTH","SIZED",
  "SKILL","SMALL","SMART","SOLID","SPEND","SPENT","SPLIT","STAFF","STAGE",
  "STAND","START","STATE","STAYS","STEPS","STILL","STOCK","STORE","STORM",
  "STORY","STUDY","STYLE","SUITS","SURGE","SWEEP","SWEET","SWIFT","TAKES",
  "TALKS","TAXES","TEAMS","TENDS","TERMS","TESTS","THANK","THEIR","THEME",
  "THERE","THESE","THIRD","THOSE","THREE","THREW","THROW","TIGHT","TIMES",
  "TODAY","TOKEN","TOTAL","TOUCH","TOUGH","TRADE","TRAIL","TREND","TRIAL",
  "TRIED","TRIED","TRUST","TRUTH","TYPES","UNDER","UNIFY","UNION","UNTIL",
  "UPSIDE","USAGE","USERS","USUAL","VALID","VALUE","VIDEO","VIEWS","VIRAL",
  "VISIT","VITAL","VOICE","WATCH","WEEKS","WHERE","WHICH","WHILE","WHOLE",
  "WHOSE","WORST","WORTH","WOULD","WRITE","WROTE","YEARS","YIELD",
  // URL fragments that survive HTML stripping
  "HTTP","HTTPS","HTML","HREF","FEED","SITE","PAGE","LINK","BLOG","CORP",
  "COMM","MAIN","LOGO","ICON","MENU","TABS","GRID","FLEX","ITEM","LIST",
  "SPAN","TEXT","CODE","NULL","VOID","TRUE","BOOL","FILE","PATH","SORT",
  "EDIT","VIEW","SAVE","LOAD","SEND","RECV","RESP","REQS","ARGS","OPTS",
  "INIT","EXEC","PROC","SERV","HOST","PORT","ADDR","CONF","TEMP","CACHE",
  "AJAX","JSON","REST","AUTH","CSRF","CORS","MIME","UUID","HASH","SLUG",
  // Finance / market jargon
  "CEO","CFO","COO","CTO","IPO","ETF","USD","GDP","CPI","SEC","FDA","FED","IMF",
  "NYSE","DJIA","SPX","VIX","OTC","ADR","ESG","EPS","TTM","BPS","QOQ","YOY",
  "BUY","SELL","HOLD","CALL","PUTS","CALLS","PUT","LONG","SHORT","CASH","BOND","DEBT","LOSS",
  "GAIN","BULL","BEAR","RISK","COST","RATE","FUND","FIRM","BANK","LOAN","SWAP",
  "EBIT","EBITDA","PEG","PNL","ROI","ROE","ROA","CAGR","NAV",
  "OPEX","CAPEX","FIFO","LIFO","GAAP","IFRS","WACC","LIBOR","SOFR",
  "REIT","SPAC","PIPE","PIPE","ARCA","BATS","CBOE","FINRA","DTCC",
  "FOMC","FDIC","CFPB","CFTC",
  // Countries / currencies
  "USA","EUR","GBP","JPY","CAD","AUD","CHF","CNY","INR","MXN","BRL",
  // Crypto (noisy on Reddit)
  "BTC","ETH","SOL","XRP","ADA","DOT","DOGE","SHIB","MATIC","AVAX","LINK",
  "LUNA","NEAR","ALGO","ATOM","SAND","MANA","GALA","FLOW","ROSE","KLAY",
  // Reddit / internet slang
  "YOLO","FOMO","TLDR","IIRC","AFAIK","IMO","OMG","LOL","WTF","TBH",
  "WSB","DD","DCA","ATH","ATL","HOD","LOD","HODL","WAGMI","GUH","LMAO",
  "EDIT","TLDR","MODS","APES","WIFE","MOON","ROPE","GANG","LOSS","GAIN",
]);

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

let cachedBuzzResult: MarketIntelScanResult | null = null;
let intelInterval: ReturnType<typeof setInterval> | null = null;
const seenBuzzHeadlines = new Map<string, number>(); // key -> timestamp

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function pruneDedup() {
  const now = Date.now();
  Array.from(seenBuzzHeadlines.entries()).forEach(([key, ts]) => {
    if (now - ts > DEDUP_TTL_MS) seenBuzzHeadlines.delete(key);
  });
}

async function safeFetch(url: string, headers: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, ...headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeForTickerExtraction(text: string): string {
  return text
    // Decode HTML entities first (&amp; → &, so "AMP" doesn't appear as a ticker)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/gi, " ")
    .replace(/&\w+;/gi, " ")
    // Remove URLs entirely (http/https/www)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    // Remove file extensions / domain fragments like .com .org .net .io
    .replace(/\b\w+\.(com|org|net|io|co|gov|edu|tv|me|app|ai|html|xml|json|php|rss|atom)\b/gi, " ")
    // Remove words that contain digits (e.g. "H1B", "Q3", "COVID19")
    .replace(/\b\w*\d\w*\b/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function extractTickerMentions(text: string): { ticker: string; weight: number }[] {
  const clean = sanitizeForTickerExtraction(text);
  const upper = clean.toUpperCase();
  const results = new Map<string, number>();

  // $TICKER prefix — strong signal (weight 3)
  const dollarMatches = Array.from(upper.matchAll(/\$([A-Z]{1,5})\b/g));
  for (const m of dollarMatches) {
    const t = m[1];
    if (!TICKER_BLOCKLIST.has(t)) {
      results.set(t, (results.get(t) || 0) + 3);
    }
  }

  // Plain ALL-CAPS TICKER — require 2–5 chars, only match uppercase runs
  // Use sanitized (URL-stripped) text so "HTTPS", "COM" etc never appear
  const capsMatches = Array.from(clean.matchAll(/\b([A-Z]{2,5})\b/g));
  for (const m of capsMatches) {
    const t = m[1];
    if (!TICKER_BLOCKLIST.has(t)) {
      results.set(t, (results.get(t) || 0) + 2);
    }
  }

  // Lower-weight scan on uppercased text (3–4 chars only, catches mixed-case tickers in titles)
  const plainMatches = Array.from(upper.matchAll(/\b([A-Z]{3,4})\b/g));
  for (const m of plainMatches) {
    const t = m[1];
    if (!TICKER_BLOCKLIST.has(t) && !results.has(t)) {
      // Only add if not already picked up by the caps scan
      results.set(t, (results.get(t) || 0) + 1);
    }
  }

  return Array.from(results.entries()).map(([ticker, weight]) => ({ ticker, weight }));
}

// ──────────────────────────────────────────────
// Fast keyword-based sentiment scorer (no AI needed)
// Returns -1.0 (very bearish) to +1.0 (very bullish)
// ──────────────────────────────────────────────

// Strong-signal bullish phrases (multi-word — checked before individual words)
const BULLISH_PHRASES = [
  "earnings beat","beat expectations","raised guidance","record revenue","record profit",
  "better than expected","above expectations","strong demand","analyst upgrade",
  "price target raised","buy rating","outperform rating","positive outlook",
  "dividend increase","share buyback","stock buyback","insider buying",
  "contract win","fda approval","regulatory approval","deal closed","merger approved",
  "revenue growth","profit growth","record high","52-week high","all-time high",
];

const BEARISH_PHRASES = [
  "earnings miss","missed expectations","lowered guidance","revenue decline",
  "worse than expected","below expectations","weak demand","analyst downgrade",
  "price target cut","sell rating","underperform rating","negative outlook",
  "dividend cut","stock offering","share dilution","insider selling",
  "contract lost","fda rejection","regulatory block","deal collapsed","merger blocked",
  "revenue loss","profit loss","record low","52-week low","all-time low",
  "sec investigation","class action","going concern","liquidity concern",
  "mass layoff","bankruptcy filing","debt default","credit downgrade",
  "recession fear","tariff impact","trade war","inflation surge",
];

// Individual word signals (lower weight than phrases)
const BULLISH_WORDS = new Set([
  // AI-action words
  "beat","beats","outperform","outperforms","upgrade","upgraded","approval","approved",
  "win","wins","won","profit","profits","profitable","growth","grew","grows",
  "raised","raise","rebound","rebounded","recovery","breakout","momentum",
  "bullish","partnership","acquisition","expansion","exceeded","exceeds","dividend",
  "innovation","breakthrough","demand","robust","confident","advancing","gains",
  // Price-movement verbs (unambiguous up)
  "surge","surges","surged","soar","soars","soared","jump","jumps","jumped",
  "rally","rallies","rallied","rise","rises","rose","risen","climbs","climbed",
  "gain","gained","boosts","boosted","lifted","lifts","rebounds",
  // Strength words
  "record","strong","strength","high","record-high","above","better","leading","top",
  "best","exceed","positive","healthy","impressive","outpaced","expanding",
]);

const BEARISH_WORDS = new Set([
  // AI-action words
  "miss","misses","missed","underperform","downgrade","downgraded","declined","rejection",
  "loss","losses","bankrupt","bankruptcy","fraud","lawsuit","investigation","probe",
  "warning","concern","concerns","recession","default","layoff","layoffs","fired",
  "dilution","dilutive","volatile","uncertainty","selloff","collapse","collapsed",
  "tariff","tariffs","bearish","worries","worried","tumbled","plunged","crashed",
  "halted","suspended","penalty","breach","struggling","shortfall","weak","cut",
  // Price-movement verbs (unambiguous down)
  "fall","falls","fell","fallen","drop","drops","dropped","sink","sinks","sank",
  "plunge","plunges","slide","slides","slid","slip","slips","slipped",
  "tumble","tumbles","retreat","retreats","retreated","decline","declines","lower",
  "dip","dips","dipped","stumble","stumbles","slump","slumps","slumped",
  // Weakness words
  "lose","loses","lost","deficit","negative","below","worse","poor","slow","sluggish",
  "pressured","pressure","drag","dragged","hurt","hurts","hurt","weighed","weigh",
]);

function scoreHeadlineSentiment(text: string): number {
  const lower = text.toLowerCase();
  let bullCount = 0;
  let bearCount = 0;

  // Check phrases first (worth 2 points each)
  for (const phrase of BULLISH_PHRASES) {
    if (lower.includes(phrase)) bullCount += 2;
  }
  for (const phrase of BEARISH_PHRASES) {
    if (lower.includes(phrase)) bearCount += 2;
  }

  // Individual words (worth 1 point each)
  const words = lower.replace(/[^a-z\s]/g, " ").split(/\s+/);
  for (const word of words) {
    if (BULLISH_WORDS.has(word)) bullCount++;
    if (BEARISH_WORDS.has(word)) bearCount++;
  }

  const total = bullCount + bearCount;
  if (total === 0) return 0;

  // Laplace-smoothed ratio: dampens extreme scores from few signals
  // Formula: (bull - bear) / (bull + bear + 4)
  // Examples: 1 bull → 1/5 = 0.20, 2 bull → 2/6 = 0.33, 1 phrase bull → 2/6 = 0.33
  //           1 phrase + 1 word bull → 3/7 = 0.43, 2 phrases → 4/8 = 0.50
  const raw = (bullCount - bearCount) / (total + 4);
  return Math.max(-1, Math.min(1, raw * 2)); // scale so strong signals reach ~0.8
}

function stripXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function parseRSSItems(xml: string): string[] {
  const titles: string[] = [];
  const descriptions: string[] = [];

  for (const m of Array.from(xml.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi))) {
    const t = stripXml(m[1]);
    if (t && t.length > 5) titles.push(t);
  }
  for (const m of Array.from(xml.matchAll(/<description[^>]*>([\s\S]*?)<\/description>/gi))) {
    const d = stripXml(m[1]);
    if (d && d.length > 10) descriptions.push(d);
  }

  return [...titles, ...descriptions].slice(0, 40);
}

// ──────────────────────────────────────────────
// Data Fetchers
// ──────────────────────────────────────────────

async function fetchRedditPosts(subreddit: string): Promise<string[]> {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25`;
  const raw = await safeFetch(url);
  const json = JSON.parse(raw);
  const posts: string[] = [];

  for (const child of json?.data?.children || []) {
    const d = child?.data;
    if (!d) continue;
    const text = [d.title || "", d.selftext || ""].join(" ").slice(0, 500);
    if (text.trim()) posts.push(text);
  }

  return posts;
}

async function fetchRSSFeed(url: string): Promise<string[]> {
  const raw = await safeFetch(url);
  return parseRSSItems(raw);
}

async function fetchSECInsiderFilings(): Promise<string[]> {
  const url = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=20&search_text=&output=atom";
  const raw = await safeFetch(url);
  const titles: string[] = [];
  for (const m of Array.from(raw.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi))) {
    const t = stripXml(m[1]);
    if (t && t.length > 3 && !t.toLowerCase().includes("edgar")) titles.push(t);
  }
  return titles.slice(0, 30);
}

// ──────────────────────────────────────────────
// Core Scanner
// ──────────────────────────────────────────────

export async function runMarketIntelScan(): Promise<MarketIntelScanResult> {
  pruneDedup();

  // tickerMap: ticker -> { count, sources, headlines, firstSeen, lastSeen }
  const tickerMap = new Map<string, {
    count: number;
    sources: Set<"reddit" | "rss" | "sec">;
    headlines: string[];
    firstSeen: string;
    lastSeen: string;
  }>();

  function addMentions(texts: string[], source: "reddit" | "rss" | "sec", displayText: string) {
    for (const text of texts) {
      const mentions = extractTickerMentions(text);
      for (const { ticker, weight } of mentions) {
        const dedupKey = `${ticker}:${text.slice(0, 60)}`;
        if (seenBuzzHeadlines.has(dedupKey)) continue;
        seenBuzzHeadlines.set(dedupKey, Date.now());

        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, {
            count: 0,
            sources: new Set(),
            headlines: [],
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          });
        }
        const entry = tickerMap.get(ticker)!;
        entry.count += weight;
        entry.sources.add(source);
        entry.lastSeen = new Date().toISOString();

        const shortText = displayText.slice(0, 120);
        if (!entry.headlines.includes(shortText) && entry.headlines.length < 5) {
          entry.headlines.push(shortText);
        }
      }
    }
  }

  const sourceStatus: MarketIntelScanResult["sourceStatus"] = {
    reddit: "skipped",
    rss: "skipped",
    sec: "skipped",
  };

  // ── Reddit ──
  try {
    const subreddits = ["wallstreetbets", "pennystocks", "stocks"];
    const allPosts: string[] = [];
    for (const sub of subreddits) {
      try {
        const posts = await fetchRedditPosts(sub);
        allPosts.push(...posts);
      } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
    addMentions(allPosts, "reddit", allPosts[0] || "");
    // Re-do with correct display texts
    tickerMap.clear(); // reset and redo properly
    for (const post of allPosts) {
      const mentions = extractTickerMentions(post);
      for (const { ticker, weight } of mentions) {
        const dedupKey = `${ticker}:${post.slice(0, 60)}`;
        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, { count: 0, sources: new Set(), headlines: [], firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
        }
        const entry = tickerMap.get(ticker)!;
        entry.count += weight;
        entry.sources.add("reddit");
        entry.lastSeen = new Date().toISOString();
        const short = post.slice(0, 120);
        if (!entry.headlines.includes(short) && entry.headlines.length < 5) entry.headlines.push(short);
      }
    }
    sourceStatus.reddit = "ok";
  } catch {
    sourceStatus.reddit = "error";
  }

  await new Promise(r => setTimeout(r, 500));

  // ── RSS Feeds ──
  const rssFeeds = [
    { url: "https://feeds.marketwatch.com/marketwatch/marketpulse/", label: "MarketWatch" },
    { url: "https://finance.yahoo.com/news/rssindex", label: "Yahoo Finance" },
    { url: "https://rss.cnn.com/rss/money_latest.rss", label: "CNN Money" },
    { url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", label: "WSJ Markets" },
  ];
  const rawRssItems: { text: string; source: string }[] = [];
  try {
    let rssTexts: string[] = [];
    for (const feed of rssFeeds) {
      try {
        const items = await fetchRSSFeed(feed.url);
        rssTexts.push(...items);
        for (const t of items) rawRssItems.push({ text: t, source: feed.label });
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }

    for (const text of rssTexts) {
      const mentions = extractTickerMentions(text);
      for (const { ticker, weight } of mentions) {
        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, { count: 0, sources: new Set(), headlines: [], firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
        }
        const entry = tickerMap.get(ticker)!;
        entry.count += weight;
        entry.sources.add("rss");
        entry.lastSeen = new Date().toISOString();
        const short = text.slice(0, 120);
        if (!entry.headlines.includes(short) && entry.headlines.length < 5) entry.headlines.push(short);
      }
    }
    sourceStatus.rss = "ok";
  } catch {
    sourceStatus.rss = "error";
  }

  await new Promise(r => setTimeout(r, 500));

  // ── SEC Form 4 Insider Filings ──
  try {
    const secTitles = await fetchSECInsiderFilings();
    for (const title of secTitles) {
      const mentions = extractTickerMentions(title);
      for (const { ticker, weight } of mentions) {
        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, { count: 0, sources: new Set(), headlines: [], firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
        }
        const entry = tickerMap.get(ticker)!;
        entry.count += weight;
        entry.sources.add("sec");
        entry.lastSeen = new Date().toISOString();
        const short = `[SEC Insider] ${title.slice(0, 100)}`;
        if (!entry.headlines.includes(short) && entry.headlines.length < 5) entry.headlines.push(short);
      }
    }
    sourceStatus.sec = "ok";
  } catch {
    sourceStatus.sec = "error";
  }

  // ── Build result ──
  const topTickers: MarketBuzzItem[] = Array.from(tickerMap.entries())
    .filter(([, v]) => v.count >= MIN_MENTIONS)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 25)
    .map(([ticker, v]) => ({
      ticker,
      mentionCount: v.count,
      sources: Array.from(v.sources) as Array<"reddit" | "rss" | "sec">,
      headlines: v.headlines,
      sentiment: 0,
      firstSeenAt: v.firstSeen,
      lastSeenAt: v.lastSeen,
    }));

  const result: MarketIntelScanResult = {
    scannedAt: new Date().toISOString(),
    totalMentions: Array.from(tickerMap.values()).reduce((s, v) => s + v.count, 0),
    topTickers,
    sourceStatus,
  };

  cachedBuzzResult = result;

  // ── Push headlines into the news store (no Finnhub needed) ──
  // RSS → MARKET news (deduplicated by headline text)
  const savedKeys = new Set<string>();
  for (const { text, source } of rawRssItems) {
    const headline = text.slice(0, 200).trim();
    if (!headline || headline.length < 20) continue;
    const key = headline.slice(0, 80).toLowerCase();
    if (savedKeys.has(key)) continue;
    savedKeys.add(key);
    try {
      await storage.addNews({
        symbol: "MARKET",
        headline,
        summary: headline,
        source,
        sentiment: scoreHeadlineSentiment(headline),
        url: null,
      });
    } catch {}
  }

  // Top buzz tickers → per-ticker news (1 headline each from Reddit / SEC)
  for (const item of topTickers.slice(0, 15)) {
    for (const headline of item.headlines.slice(0, 2)) {
      const h = headline.slice(0, 200).trim();
      if (!h || h.length < 15) continue;
      const key = `${item.ticker}:${h.slice(0, 60).toLowerCase()}`;
      if (savedKeys.has(key)) continue;
      savedKeys.add(key);
      const src = item.sources.includes("sec")
        ? "SEC EDGAR"
        : item.sources.includes("reddit")
        ? "Reddit"
        : "RSS";
      try {
        await storage.addNews({
          symbol: item.ticker,
          headline: h,
          summary: h,
          source: src,
          sentiment: scoreHeadlineSentiment(h),
          url: null,
        });
      } catch {}
    }
  }

  const statusStr = Object.entries(sourceStatus).map(([k, v]) => `${k}:${v}`).join(" ");
  addAutoTradeLog(
    "scan",
    `Market intel scan complete: ${topTickers.length} trending tickers (${statusStr})`
  );

  return result;
}

export function getMarketBuzz(): MarketIntelScanResult | null {
  return cachedBuzzResult;
}

export function startMarketIntelMonitor(): void {
  // Run immediately
  runMarketIntelScan().catch(() => {});

  intelInterval = setInterval(() => {
    runMarketIntelScan().catch(() => {});
  }, MARKET_INTEL_INTERVAL_MS);
}

export function stopMarketIntelMonitor(): void {
  if (intelInterval) {
    clearInterval(intelInterval);
    intelInterval = null;
  }
}
