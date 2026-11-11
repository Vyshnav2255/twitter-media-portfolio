#!/usr/bin/env node

// Fetches your media tweets and profile info via Twitter's internal GraphQL API.
// Uses your x.com login from any installed browser (see browser-cookies.js).
// Outputs portfolio-data.json

const { execFileSync } = require("child_process");
const { writeFileSync, readFileSync, existsSync } = require("fs");
const { join } = require("path");
const { getXCookies } = require("./browser-cookies");
const {
  downloadVideoToLocal,
  cleanupUnusedVideoFiles,
  getBestVideoUrl,
} = require("./video-files");

// --- Config ---

const CONFIG_PATH = join(__dirname, "portfolio.config.json");
const AUTO_PRUNE = true;

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { handle: "", maxPosts: 100, hiddenIds: [] };
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

const config = loadConfig();
const SCREEN_NAME = config.handle;
const MAX_POSTS = config.maxPosts || 100;
// "auto" (default) scans every installed browser. A name, or a list of names,
// is tried first, then everything else, so a missing browser never stops a sync.
const COOKIE_BROWSER = config.cookieBrowser || config.browser || "auto";
const COOKIE_PROFILE = config.cookieProfile || config.browserProfile || "";
const HIDDEN_MEDIA_IDS = new Set(config.hiddenMediaIds || []);
const HIDDEN_POST_IDS = new Set(config.hiddenIds || []);

if (!SCREEN_NAME) {
  console.error("No handle configured. Set your Twitter handle in portfolio.config.json:");
  console.error('  { "handle": "yourusername", "maxPosts": 100 }');
  process.exit(1);
}

const X_PUBLIC_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const GRAPHQL_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

// --- Cookie extraction ---

// Read once per run: every GraphQL call reuses it, so the Keychain is asked
// at most once per browser.
let cachedCookies = null;
function getTwitterCookies() {
  if (!cachedCookies) {
    cachedCookies = getXCookies({ preferred: COOKIE_BROWSER, profile: COOKIE_PROFILE });
    console.log(`Using your x.com login from ${cachedCookies.browser}`);
  }
  return cachedCookies;
}

// --- GraphQL fetch ---

function fetchGraphQL(queryId, operation, variables, fieldToggles) {
  const { csrfToken, cookieHeader } = getTwitterCookies();

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(GRAPHQL_FEATURES),
  });
  if (fieldToggles) {
    params.set("fieldToggles", JSON.stringify(fieldToggles));
  }

  const url = `https://x.com/i/api/graphql/${queryId}/${operation}?${params}`;

  let result;
  try {
    result = execFileSync("curl", [
      "-s", "-S", "--fail-with-body",
      "--connect-timeout", "15", "--max-time", "60",
      // curl retries timeouts, HTTP 408/429 and transient server errors.
      // Keep retries bounded so an unavailable API eventually fails clearly.
      "--retry", "3", "--retry-max-time", "240",
      "-H", `authorization: Bearer ${X_PUBLIC_BEARER}`,
      "-H", `x-csrf-token: ${csrfToken}`,
      "-H", "x-twitter-auth-type: OAuth2Session",
      "-H", "x-twitter-active-user: yes",
      "-H", `cookie: ${cookieHeader}`,
      "-H", "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      url,
    ], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  } catch (error) {
    const text = String(error?.stderr || error?.message || "");
    throw new Error(`GraphQL request failed: ${text.trim() || error.message}`);
  }

  let json;
  try {
    json = JSON.parse(result);
  } catch (error) {
    const trimmed = String(result || "").trim();
    throw new Error(`Invalid JSON from GraphQL: ${trimmed.slice(0, 180)}`);
  }
  if (json.errors?.length) {
    throw new Error(`${operation} failed: ${json.errors.map((error) => error.message || `code ${error.code}`).join("; ")}`);
  }
  return json;
}

// --- Parse tweet ---

function shouldSkipMediaDownload(tweetId, mediaIndex) {
  return HIDDEN_POST_IDS.has(String(tweetId)) || HIDDEN_MEDIA_IDS.has(`${tweetId}-${mediaIndex}`);
}

function parseTweet(tweetResult) {
  const tweet = tweetResult?.tweet ?? tweetResult;
  const legacy = tweet?.legacy;
  if (!legacy) return null;

  const tweetId = legacy.id_str ?? tweet?.rest_id;
  if (!tweetId) return null;

  const userResult = tweet?.core?.user_results?.result;
  const authorHandle = userResult?.legacy?.screen_name;

  const mediaEntities = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  if (mediaEntities.length === 0) return null;

  const images = mediaEntities.map((m, index) => {
    const variants = Array.isArray(m.video_info?.variants) ? m.video_info.variants : [];
    const mp4Variants = variants
      .filter((v) => v.content_type === "video/mp4" && v.url)
      .map((v) => ({
        url: v.url,
        bitrate: v.bitrate || 0,
      }))
      .sort((a, b) => b.bitrate - a.bitrate);

    const bestVideoUrl = getBestVideoUrl({ videoVariants: mp4Variants });
    const isHidden = shouldSkipMediaDownload(tweetId, index);
    let localVideoUrl = null;
    if (!isHidden && bestVideoUrl) {
      try {
        localVideoUrl = downloadVideoToLocal(bestVideoUrl, tweetId, index);
      } catch (error) {
        console.warn(`  Failed to download video for ${tweetId}: ${error.message}`);
      }
    }

    return {
      url: m.media_url_https,
      width: m.original_info?.width ?? m.sizes?.large?.w ?? 1,
      height: m.original_info?.height ?? m.sizes?.large?.h ?? 1,
      type: m.type || "photo",
      videoUrl: isHidden ? null : localVideoUrl,
      videoVariants: mp4Variants,
    };
  });

  return {
    id: tweetId,
    text: legacy.full_text ?? "",
    url: `https://x.com/${authorHandle || SCREEN_NAME}/status/${tweetId}`,
    postedAt: legacy.created_at ?? "",
    images,
    likeCount: legacy.favorite_count ?? 0,
    repostCount: legacy.retweet_count ?? 0,
    bookmarkCount: legacy.bookmark_count ?? 0,
  };
}

// --- Main ---

async function main() {
  console.log(`Fetching media posts for @${SCREEN_NAME}...\n`);

  // 1. Get user profile
  // Note: query IDs change when Twitter updates their app.
  // If this fails, inspect the network tab on x.com to find current IDs.
  const userJson = fetchGraphQL("NimuplG1OB7Fd2btCLdBOw", "UserByScreenName", {
    screen_name: SCREEN_NAME,
    withSafetyModeUserFields: true,
  });

  const userResult = userJson?.data?.user?.result;
  const userId = userResult?.rest_id;
  if (!userId) {
    console.error("Could not find user. The UserByScreenName query ID may have changed.");
    console.error("Check the network tab on x.com for the current query ID.");
    process.exit(1);
  }

  const userLegacy = userResult?.legacy;
  const profile = {
    name: userLegacy?.name || SCREEN_NAME,
    handle: SCREEN_NAME,
    bio: (userLegacy?.description || "").substring(0, 140),
    avatar: userLegacy?.profile_image_url_https?.replace("_normal", "_400x400") || "",
    url: `https://x.com/${SCREEN_NAME}`,
  };

  console.log(`Profile: ${profile.name} (@${profile.handle})`);
  console.log(`Bio: ${profile.bio}\n`);

  // 2. Fetch UserMedia timeline
  const allTweets = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    const variables = {
      userId,
      count: 20,
      includePromotedContent: false,
      withClientEventToken: false,
      withBirdwatchNotes: false,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) variables.cursor = cursor;

    process.stdout.write(`  Page ${page} (${allTweets.length} media tweets so far)...\r`);

    let json;
    try {
      json = fetchGraphQL("y4E0HTZKPhAOXewRMqMqgw", "UserMedia", variables, {
        withArticlePlainText: false,
      });
    } catch (e) {
      throw new Error(`Sync failed on page ${page} after fetching ${allTweets.length} media posts: ${e.message}. Existing portfolio data was not replaced; video cleanup was skipped.`);
    }

    const instructions = json?.data?.user?.result?.timeline_v2?.timeline?.instructions
      ?? json?.data?.user?.result?.timeline?.timeline?.instructions;
    if (!Array.isArray(instructions)) {
      throw new Error(`No media timeline in the response for page ${page}. Existing portfolio data was not replaced; video cleanup was skipped.`);
    }
    let newTweets = 0;
    let nextCursor = null;

    for (const instruction of instructions) {
      // First page: TimelineAddEntries with module items
      if (instruction.type === "TimelineAddEntries" || instruction.entries) {
        const entries = instruction.entries ?? [];
        for (const entry of entries) {
          if (entry.content?.items) {
            for (const item of entry.content.items) {
              const result = item.item?.itemContent?.tweet_results?.result;
              if (!result) continue;
              const tw = result.__typename === "TweetWithVisibilityResults"
                ? parseTweet(result.tweet)
                : parseTweet(result);
              if (tw) { allTweets.push(tw); newTweets++; }
            }
          }
          if (entry.content?.itemContent?.tweet_results?.result) {
            const result = entry.content.itemContent.tweet_results.result;
            const tw = result.__typename === "TweetWithVisibilityResults"
              ? parseTweet(result.tweet)
              : parseTweet(result);
            if (tw) { allTweets.push(tw); newTweets++; }
          }
          if (entry.content?.cursorType === "Bottom" || entry.entryId?.startsWith("cursor-bottom")) {
            nextCursor = entry.content?.value;
          }
        }
      }
      // Subsequent pages: TimelineAddToModule with moduleItems
      if (instruction.type === "TimelineAddToModule") {
        const moduleItems = instruction.moduleItems ?? [];
        for (const item of moduleItems) {
          const result = item.item?.itemContent?.tweet_results?.result;
          if (!result) continue;
          const tw = result.__typename === "TweetWithVisibilityResults"
            ? parseTweet(result.tweet)
            : parseTweet(result);
          if (tw) { allTweets.push(tw); newTweets++; }
        }
        // Cursor can also be in moduleEntryId
        if (instruction.prepend === false || instruction.prepend === undefined) {
          // Look for cursor in the entries too
        }
      }
    }

    // Also look for cursor in top-level entries on subsequent pages
    if (!nextCursor) {
      for (const instruction of instructions) {
        if (instruction.type === "TimelineAddEntries") {
          const entries = instruction.entries ?? [];
          for (const entry of entries) {
            if (entry.content?.cursorType === "Bottom" || entry.entryId?.startsWith("cursor-bottom")) {
              nextCursor = entry.content?.value;
            }
          }
        }
      }
    }

    console.log(`  Page ${page}: +${newTweets} tweets (${allTweets.length} total)          `);

    if (!nextCursor || newTweets === 0) break;
    if (allTweets.length >= MAX_POSTS) break;
    cursor = nextCursor;
  }

  if (allTweets.length === 0) {
    throw new Error("Sync returned no media posts. Existing portfolio data was not replaced; video cleanup was skipped.");
  }

  // 3. Deduplicate
  const seen = new Set();
  const unique = [];
  for (const tw of allTweets) {
    if (!seen.has(tw.id)) {
      seen.add(tw.id);
      unique.push(tw);
    }
  }

  // 4. Sort by most recent, take up to MAX_POSTS
  unique.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  const posts = unique.slice(0, MAX_POSTS);

  // 5. Output
  const output = { profile, posts };
  const outPath = join(__dirname, "portfolio-data.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  // Remove stale cached videos and any files for currently hidden media.
  if (AUTO_PRUNE) {
    cleanupUnusedVideoFiles(posts, config);
  }

  // Update config with profile info (preserve hiddenIds)
  config.handle = SCREEN_NAME;
  if (!config.hiddenIds) config.hiddenIds = [];
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log(`\nDone! Exported ${posts.length} media posts to ${outPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
