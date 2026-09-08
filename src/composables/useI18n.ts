import { ref, computed } from 'vue'
import { readCache, writeCache } from '../lib/cache'
import { chainOf } from '../lib/format'

export type Lang = 'en' | 'zh'

const DICT: Record<string, { en: string; zh: string }> = {
  'tab.specials': { en: 'Specials', zh: '特價' },
  'tab.browse': { en: 'Browse', zh: '分類' },
  'tab.recipes': { en: 'Recipes', zh: '食譜' },
  'tab.list': { en: 'List', zh: '清單' },
  'tab.me': { en: 'Me', zh: '我的' },

  'common.loading': { en: 'Loading…', zh: '載入中…' },
  'common.back': { en: '‹ Specials', zh: '‹ 特價' },
  'common.done': { en: 'Done', zh: '完成' },
  'common.stores': { en: '{n} stores', zh: '{n} 家店' },
  'common.signIn': { en: 'Sign in', zh: '登入' },
  'auth.title': { en: 'Sign in with Google', zh: '用 Google 登入' },
  'auth.google': { en: 'Continue with Google', zh: '用 Google 帳號登入' },
  'auth.why1': { en: 'Your stores and list on every device', zh: '選的店、清單，換手機也在' },
  'auth.why2': { en: 'Follow items and get told when they go on special', zh: '關注商品，有特價就通知' },
  'auth.why3': { en: 'Share your list with a link', zh: '清單用連結分享' },
  'auth.guestNote': { en: 'Comparing prices works without signing in. Signing in only saves things.', zh: '不登入也能比價。登入只是為了存東西。' },
  'auth.merged': { en: 'Signed in. Your guest stores and list were merged into this account.', zh: '登入了。訪客時選的店和清單已合併到帳號。' },
  'auth.signOut': { en: 'Sign out', zh: '登出' },
  'auth.signedInAs': { en: 'Signed in with Google', zh: '已用 Google 登入' },
  'me.watching': { en: 'Following', zh: '關注中' },
  'me.notify': { en: 'Push notifications', zh: '推播通知' },
  'me.notifyOn': { en: 'On · Monday digest + followed items', zh: '已開 · 週一摘要 + 關注商品有特價' },
  'me.notifyHint': { en: 'One push after Monday\'s update. Nothing else.', zh: '只在週一資料更新後推一次，沒有別的。' },
  'me.notifyBusy': { en: 'Working…', zh: '處理中…' },
  'me.notifyIos': { en: 'iPhone: tap Share → Add to Home Screen, open it from there, then turn this on.', zh: 'iPhone 要先按「分享 → 加入主畫面」，從主畫面打開再來開這個。' },
  'me.notifyDenied': { en: 'Notifications are blocked in your browser settings.', zh: '瀏覽器把通知封鎖了，要去設定裡打開。' },
  'me.notifyUnsupported': { en: 'This browser cannot receive push notifications.', zh: '這個瀏覽器不支援推播。' },
  'me.notifyFailed': { en: 'Could not turn on: {e}', zh: '開不起來：{e}' },
  'watching.title': { en: 'Following', zh: '關注中' },
  'watching.back': { en: '‹ Me', zh: '‹ 我的' },
  'watching.sub': { en: '{n} items · they show on the home page when on special', zh: '{n} 項 · 有特價時會出現在首頁' },
  'watching.onSpecial': { en: 'On special this week', zh: '本週有特價' },
  'watching.noSpecial': { en: 'No special at your stores this week', zh: '你的店本週沒特價' },
  'watching.unfollow': { en: 'Unfollow', zh: '取消關注' },
  'watching.empty': { en: "You're not following anything yet", zh: '還沒關注任何商品' },
  'watching.emptyHint': { en: 'Open a product and tap ☆ Follow.', zh: '打開商品，按 ☆ 關注。' },
  'watching.signIn': { en: 'Sign in with Google to follow items.', zh: '要用 Google 登入才能關注商品。' },
  'home.watched': { en: 'Your followed items on special', zh: '你關注的有特價' },
  'home.where': { en: 'Where to go this week', zh: '這週去哪家' },
  'home.whereWins': { en: 'cheapest for {w} of {n} matched items', zh: '{n} 樣兩邊都有的，{w} 樣這家最便宜' },
  'p.lowest8': { en: 'Lowest in the last 8 weeks', zh: '近 8 週最低' },
  'p.history': { en: 'Price history · last 8 weeks', zh: '價格走勢 · 近 8 週' },
  'p.thisWeek': { en: 'this week', zh: '本週' },
  'p.followed': { en: '★ Following', zh: '★ 已關注' },
  'p.followSignIn': { en: '☆ Follow · sign in', zh: '☆ 關注 · 要登入' },
  'list.share': { en: 'Share link', zh: '分享連結' },
  'list.shared': { en: 'Link copied ✓', zh: '連結已複製 ✓' },
  'list.shareSignIn': { en: 'Sign in to share', zh: '登入才能分享' },
  'shared.title': { en: 'Shared list', zh: '分享的清單' },
  'shared.readonly': { en: 'Read-only · shared with you', zh: '唯讀 · 別人分享給你的' },
  'shared.copy': { en: 'Copy into my list', zh: '複製到我的清單' },
  'shared.copied': { en: 'Copied ✓', zh: '已複製 ✓' },
  'shared.notFound': { en: 'This list is not available.', zh: '找不到這份清單。' },
  'common.items': { en: '{n} items', zh: '{n} 項' },

  'home.headline': {
    en: '{n} specials at your {s} stores this week. Biggest single saving {save}.',
    zh: '你附近 {s} 家店本週 {n} 項特價，單項最多省 {save}。',
  },
  'home.headlineNoSave': {
    en: '{n} specials at your {s} stores this week.',
    zh: '你附近 {s} 家店本週 {n} 項特價。',
  },
  'home.ends': { en: 'Ends Sunday', zh: '特價到週日' },
  'home.daysLeft': { en: '{d} days left', zh: '剩 {d} 天' },
  'home.best': { en: 'Best deals this week', zh: '這週最划算' },
  'home.top10': { en: 'Top 10 ›', zh: 'Top 10 ›' },
  'home.half': { en: '½ price & 40% off', zh: '半價 · 六折以下' },
  'home.fresh': { en: 'Fresh, by $/kg', zh: '生鮮，每公斤最便宜' },
  'home.more': { en: '{n} ›', zh: '{n} 項 ›' },
  'home.pickStores': { en: 'Pick your stores to start', zh: '先選店才能比價' },
  'home.pickStoresBody': {
    en: 'We compare the same item across the stores you pick.',
    zh: '選好店之後，我們比同一樣東西在哪家最便宜。',
  },
  'home.noCompare': {
    en: 'No item is on special at 2+ of your stores this week.',
    zh: '本週沒有兩家以上同時特價的商品。',
  },

  'stores.title': { en: 'Your stores', zh: '我的店' },
  'stores.locating': { en: 'Finding stores near you…', zh: '正在找附近的店…' },
  'stores.tagline': {
    en: "Same item, which store is cheapest this week.",
    zh: '同一樣東西，這週哪家最便宜。',
  },
  'stores.typeTown': { en: 'Type my town instead', zh: '改用鎮名搜尋' },
  'stores.placeholder': { en: 'town or store', zh: '鎮名或店名' },
  'stores.nearestFirst': { en: 'Nearest first', zh: '由近到遠' },
  'stores.selected': { en: '{n} of 3 selected', zh: '已選 {n} / 3' },
  'stores.cta': { en: "Show this week's specials", zh: '看本週特價' },
  'stores.noData': { en: 'no data', zh: '此店無資料' },
  'stores.noWeekData': { en: 'no data this week', zh: '此店本週無資料' },
  'stores.unknownDistance': { en: 'distance unknown', zh: '距離未知' },
  'stores.islandWarn': {
    en: 'You picked stores on both islands — prices differ a lot between them.',
    zh: '你選了跨島的店 —— 兩島價格差很多。',
  },
  'stores.island.NI': { en: 'NORTH ISLAND', zh: '北島' },
  'stores.island.SI': { en: 'SOUTH ISLAND', zh: '南島' },
  'stores.islandNote': { en: 'Prices differ a lot between islands.', zh: '兩島價格差很多。' },
  'stores.maxWarn': { en: 'One store per chain. Tap another to swap it.', zh: '每家超市各一間，再點同一家的另一間會換掉。' },
  'stores.denied': {
    en: "Location is off — type a town instead.",
    zh: '定位沒開 —— 直接打鎮名。',
  },
  'stores.none': { en: 'No store matches that.', zh: '找不到符合的店。' },
  'stores.nearby': { en: 'Nearby · not selected', zh: '附近 · 未選' },
  'stores.more': { en: '{n} more — search by town to narrow it down.', zh: '還有 {n} 家 —— 打鎮名縮小範圍。' },

  'store.stale': { en: 'not updated this week', zh: '資料未更新' },
  'store.lastData': { en: 'Last data: {d}', zh: '最後資料：{d}' },
  'store.excluded': {
    en: 'Greyed stores never win a ✓ and are left out of totals.',
    zh: '灰色的店不會拿 ✓，也不算進總價。',
  },

  'cmp.noSpecial': { en: 'no special this week', zh: '本週無特價' },
  'cmp.noSpecialAt': { en: '{s} — no special this week', zh: '{s} — 本週無特價' },
  'cmp.noSpecialCount': { en: '{n} other stores — no special this week', zh: '另外 {n} 家本週無特價' },
  'cmp.only': { en: 'ONLY STORE ON SPECIAL', zh: '只有這家特價' },
  'cmp.same': { en: 'SAME ITEM · {n} STORES', zh: '同一樣 · {n} 家' },
  'cmp.nStores': { en: '{c} · {n} stores', zh: '{c} · {n} 家店' },
  'cmp.gap': { en: '{v} gap', zh: '價差 {v}' },
  'cmp.others': { en: 'Others {v}', zh: '其他店 {v}' },
  'cmp.cheapest': { en: 'Cheapest · {s}', zh: '最便宜 · {s}' },
  'cmp.byUnit': { en: 'compared by unit price', zh: '用單價比' },
  'cmp.dealPrice': { en: 'compared at deal price', zh: '用湊滿價比' },
  'cmp.familyAlt': { en: 'Similar: {n} {v}', zh: '同類：{n} {v}' },
  'cmp.familyAltAt': { en: 'Similar · {s}: {n} {v}', zh: '同類 · {s}：{n} {v}' },
  'cmp.familyAltMany': { en: 'Similar · {k} stores: {n} from {v}', zh: '同類 · {k} 家：{n} 最低 {v}' },
  'p.family': { en: 'Similar items · compare by unit price', zh: '同類可比 · 用單價比' },
  'p.variants': { en: 'Flavours & sizes', zh: '口味 / 規格' },
  'card.variants': { en: '{n} options', zh: '{n} 款' },
  'p.familyNamed': { en: 'Similar · {n} · by unit price', zh: '同類可比 · {n} · 用單價比' },

  'tag.half': { en: 'HALF PRICE', zh: '半價' },
  'tag.pct': { en: '{p}% OFF', zh: '省 {p}%' },
  'tag.save': { en: 'SAVE {v}', zh: '省 {v}' },
  'tag.multi': { en: '{q} FOR {v}', zh: '{q} 件 {v}' },
  'tag.club': { en: 'CLUBCARD', zh: 'CLUBCARD' },
  'tag.low': { en: 'LOW PRICE', zh: '低價標籤' },

  'browse.title': { en: 'Browse', zh: '分類瀏覽' },
  'browse.foodOnly': { en: 'Food only', zh: '只看食品' },
  'browse.all': { en: 'All', zh: '全部' },
  'browse.byKg': { en: 'by $/kg', zh: '依每公斤' },
  'browse.byPrice': { en: 'by price', zh: '依價格' },
  'browse.empty': { en: 'Nothing on special here this week.', zh: '這個分類本週沒有特價。' },

  'search.placeholder': { en: "Search this week's specials", zh: '搜尋本週特價' },
  'search.clear': { en: 'Clear', zh: '清除' },
  'search.empty': { en: 'No specials for "{q}"', zh: '「{q}」沒有特價' },
  'search.emptyHint': {
    en: 'We only list items on special this week.',
    zh: '我們只收錄本週有特價的商品。',
  },
  'search.lowToHigh': { en: '{n} · Same item · low to high', zh: '{n} · 同一樣 · 由低到高' },

  'p.addToList': { en: '+ Add to list', zh: '+ 加入清單' },
  'p.added': { en: '✓ In your list', zh: '✓ 已在清單' },
  'p.follow': { en: '☆ Follow', zh: '☆ 關注' },
  'p.followNote': {
    en: "Follow needs a Google sign-in — we'll tell you when it's on special again",
    zh: '關注要用 Google 登入 —— 再有特價我們就通知你',
  },
  'p.listedAs': { en: 'Listed as', zh: '各店品名' },
  'p.open': { en: 'open ↗', zh: '前往 ↗' },
  'p.openNote': { en: 'Pick your store on their site first, or the price shown there will be for a different store.', zh: '到超市網站要先選店，才看得到這家店的價格。' },
  'p.clubNeeded': { en: 'Clubcard needed (free)', zh: '需 Clubcard（免費）' },
  'p.lowPrice': { en: 'Low price label · no was-price', zh: '低價標籤 · 沒有原價' },
  'p.notFound': { en: 'Not on special at your stores.', zh: '你的店本週沒有這項特價。' },

  'list.title': { en: 'My list', zh: '我的清單' },
  'list.split': { en: 'Cheapest split · {v}', zh: '最省 · {v}' },
  'list.oneStop': { en: 'One stop · from {v}', zh: '一站 · 起 {v}' },
  'list.empty': { en: 'List is empty', zh: '清單是空的' },
  'list.emptyHint': {
    en: 'Add from specials, search or a product page.',
    zh: '從特價、搜尋或商品頁加進來。',
  },
  'list.addPlaceholder': { en: 'Add an item…', zh: '新增項目…' },
  'list.add': { en: 'Add', zh: '加入' },
  'list.freeText': { en: 'free text · not matched', zh: '自由輸入 · 未配對' },
  'list.saved': { en: 'Saved on this device', zh: '存在這台裝置' },
  'list.known': {
    en: '{k} of {m} known · {n} no special this week',
    zh: '{m} 項裡 {k} 項已知 · {n} 項本週無特價',
  },
  'list.from': { en: 'from {v}', zh: '起 {v}' },
  'list.unmatched': { en: 'Not matched to a special', zh: '沒有配對到特價' },

  'me.title': { en: 'Me', zh: '我的' },
  'me.guest': { en: 'Browsing as a guest', zh: '訪客瀏覽中' },
  'me.guestBody': {
    en: 'Everything you see works without an account. Sign in later to follow items, get Monday alerts and keep your list on other phones.',
    zh: '不用登入也能全部使用。之後登入可以關注商品、收週一通知、清單跨裝置同步。',
  },
  'me.soon': { en: 'Coming later', zh: '之後推出' },
  'me.myStores': { en: 'My stores', zh: '我的店' },
  'me.language': { en: 'Language · 語言', zh: '語言 · Language' },
  'me.foodOnly': { en: 'Food only', zh: '只看食品' },
  'me.footnote': {
    en: "Prices from each store's online shop, refreshed Mondays. Only items on special are listed.",
    zh: '價格來自各店線上購物，每週一更新。只收錄有特價的商品。',
  },

  'ai.cookFromList': { en: 'Cook from list', zh: '用清單做菜' },
  'ai.cookSignIn': { en: 'Cook from list · sign in', zh: '用清單做菜 · 需登入' },
  'ai.needSignIn': {
    en: 'AI recipes need you signed in. It costs real money per recipe, so we cap it per account.',
    zh: 'AI 食譜要登入才能用。每寫一道都真的要付費，所以是照帳號算次數的。',
  },
  'ai.pickSub': { en: 'Tick what you want to cook with. Two or more works best.', zh: '勾要拿來做菜的食材，兩樣以上比較好發揮。' },
  'ai.picked': { en: '{n} picked', zh: '已選 {n} 樣' },
  'ai.go': { en: 'AI recipe ›', zh: 'AI 食譜 ›' },
  'ai.dirTitle': { en: 'What to cook', zh: '可以做什麼' },
  'ai.dirSub': { en: 'A few directions from your {n} picked items. Pick one to get the full recipe.', zh: '用你選的 {n} 樣想出幾個方向。點一個看完整食譜。' },
  'ai.serves': { en: '{n} people', zh: '{n} 人份' },
  'ai.under': { en: 'Under {m} min', zh: '{m} 分內' },
  'ai.spice.mild': { en: 'Not spicy', zh: '不辣' },
  'ai.spice.medium': { en: 'A bit spicy', zh: '微辣' },
  'ai.spice.hot': { en: 'Spicy', zh: '辣' },
  'ai.avoidPlaceholder': { en: "Anything you don't eat? e.g. no pork", zh: '有不吃的嗎？例如：不吃豬肉' },
  'ai.uses': { en: 'Uses {n} of your {m}', zh: '用到你選的 {n}/{m} 樣' },
  'ai.missing': { en: 'buy: {s}', zh: '要買：{s}' },
  'ai.thinking': { en: 'Thinking of four ways to cook this…', zh: '正在想四個做法…' },
  'ai.cooking': { en: 'Writing the recipe…', zh: '正在寫食譜…' },
  'ai.another': { en: 'Show me different ones', zh: '換一批' },
  'ai.anotherDish': { en: 'Try another dish this way', zh: '同一個方向換一道' },
  'ai.badge': { en: 'AI RECIPE', zh: 'AI 食譜' },
  'ai.inList': { en: 'Already on your list', zh: '清單裡有了' },
  'ai.buyNoSpecial': { en: 'Need to buy · no special this week', zh: '要買 · 本週無特價' },
  'ai.addBuys': { en: '+ Add {n} to list · ≈ {v}', zh: '+ 把 {n} 樣加進清單 · 約 {v}' },
  'ai.backList': { en: '‹ List', zh: '‹ 清單' },
  'ai.quota': {
    en: "That's all the AI recipes for today. Come back tomorrow.",
    zh: '今天的 AI 食譜用完了，明天再來。',
  },
  'ai.failed': { en: "Couldn't think of anything just now. Try again.", zh: '現在想不出來，再試一次。' },
  'ai.lost': { en: 'Lost track of that one. Pick it again from your list.', zh: '找不到剛才選的，回清單重選一次。' },
  'ai.retry': { en: 'Try again', zh: '再試一次' },
  'ai.disclaimer': {
    en: 'Written by AI from your list. Check it makes sense before you cook, especially times and temperatures.',
    zh: 'AI 依你的清單寫的。下鍋前自己看一下合不合理，尤其是時間和溫度。',
  },
  'recipes.title': { en: 'Cook this week', zh: '這週煮什麼' },
  'recipes.sub': {
    en: "Ranked by how many ingredients are on special at your stores, then by what a serve costs. Prices are for the pack you'd buy.",
    zh: '依「你選的店有幾樣在特價」排，同分的比每份成本。價格是整包的價錢除以份數。',
  },
  'recipes.recommended': { en: 'Recommended', zh: '推薦' },
  'recipes.under30': { en: 'Under 30 min', zh: '30 分內' },
  'recipes.meta': { en: '{serves} serves · {min} min', zh: '{serves} 人份 · {min} 分鐘' },
  'recipes.onSpecial': { en: '{n}/{m} on special', zh: '{n}/{m} 樣特價' },
  'recipes.perServe': { en: '{v} a serve', zh: '每份 {v}' },
  'recipes.noStores': { en: 'Pick your stores first to see which ingredients are on special.', zh: '先選店，才知道哪些食材在特價。' },
  'recipes.badge': { en: '{n} of {m} ingredients on special · #{k} this week', zh: '{m} 樣食材 {n} 樣特價 · 本週第 {k}' },
  'recipes.back': { en: 'Back', zh: '返回' },
  'recipes.easy': { en: 'Easy', zh: '簡單' },
  'recipes.medium': { en: 'Medium', zh: '中等' },
  'recipes.hard': { en: 'Involved', zh: '費工' },
  'recipes.kcal': { en: '{n} kcal / serve', zh: '每份 {n} kcal' },
  'recipes.add': { en: '+ Add {n} ingredients · ≈ {v}', zh: '+ 加入 {n} 樣食材 · 約 {v}' },
  'recipes.addNoPrice': { en: '+ Add {n} ingredients', zh: '+ 加入 {n} 樣食材' },
  'recipes.added': { en: 'Added · Open list ›', zh: '已加入 · 看清單 ›' },
  'recipes.share': { en: 'Share', zh: '分享' },
  'recipes.ingredients': { en: 'Ingredients', zh: '食材' },
  'recipes.cheapest': { en: 'Cheapest store per item', zh: '每樣挑最便宜的店' },
  'recipes.noSpecial': { en: 'No special this week', zh: '本週無特價' },
  'recipes.notOnSpecial': { en: 'NOT ON SPECIAL', zh: '無特價' },
  'recipes.optional': { en: 'optional', zh: '選配' },
  'recipes.was': { en: 'was {v}', zh: '原價 {v}' },
  'recipes.staples': { en: '{s} are pantry staples — not added to your list.', zh: '{s}是常備品，不加進清單。' },
  'recipes.method': { en: 'Method', zh: '做法' },
  'recipes.tip': { en: 'Tip', zh: '小撇步' },
  'recipes.photo': { en: 'Photo: {p} · Pexels', zh: '照片：{p} · Pexels' },

  'top10.title': { en: 'Best deals this week', zh: '這週最划算' },
  'top10.sub': {
    en: 'Same item at 2+ of your stores, ranked by price gap and discount depth.',
    zh: '兩家以上都有的同一樣東西，依價差和折扣深度排。',
  },
  'half.title': { en: '½ price & 40% off+', zh: '半價 · 六折以下' },
  'half.pns': { en: "PAK'nSAVE low prices this week", zh: "PAK'nSAVE 本週低價" },
  'half.pnsNote': {
    en: "PAK'nSAVE publishes no was-prices, so it can't make the half-price list. These are its low-price tags that beat the other stores you picked.",
    zh: "PAK'nSAVE 不寫原價，算不出折扣，進不了半價榜。這裡列的是它的低價標籤裡，比你選的其他店便宜的。",
  },
  'half.pnsNoCompare': { en: 'Pick a New World or Woolworths store to compare.', zh: '再選一家 New World 或 Woolworths 才能比較。' },
  'half.note': {
    en: "PAK'nSAVE publishes no was-prices, so % off can't be computed. Its low prices are listed below.",
    zh: "PAK'nSAVE 沒有原價，算不出折數，它的低價另外列在下面。",
  },
  'fresh.title': { en: 'Fresh, by $/kg', zh: '生鮮，每公斤' },
  'fresh.meat': { en: 'Meat & poultry', zh: '肉與家禽' },
  'fresh.produce': { en: 'Fruit & veg', zh: '蔬果' },
}

const lang = ref<Lang>(readCache<Lang>('lang') ?? 'zh')
const zhCats = ref<Record<string, string>>({})
let zhLoaded = false

async function loadZhCats(): Promise<void> {
  if (zhLoaded) return
  zhLoaded = true
  try {
    const mod = await import('../data/taxonomy-zh.json')
    zhCats.value = (mod.default ?? mod) as Record<string, string>
  } catch {
    zhCats.value = {}
  }
}
void loadZhCats()

const CHAIN_LABEL: Record<string, { en: string; zh: string }> = {
  woolworths: { en: 'WW', zh: '綠超' },
  newworld: { en: 'NW', zh: '紅超' },
  paknsave: { en: 'PNS', zh: '黃超' },
}

export function setLang(l: Lang): void {
  lang.value = l
  writeCache('lang', l)
  document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en'
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const entry = DICT[key]
  let s = entry ? entry[lang.value] : key
  for (const [k, v] of Object.entries(params)) s = s.replaceAll('{' + k + '}', String(v))
  return s
}

/** Category names translate; product names stay English (§8). */
export function catName(englishName: string | undefined | null): string {
  if (!englishName) return ''
  if (lang.value === 'zh') return zhCats.value[englishName] ?? englishName
  return englishName
}

export function chainBadge(storeId: string): string {
  const c = CHAIN_LABEL[chainOf(storeId)]
  return c ? c[lang.value] : '?'
}

export { lang }

export function useI18n() {
  return { lang, t, catName, setLang, chainBadge, isZh: computed(() => lang.value === 'zh') }
}
