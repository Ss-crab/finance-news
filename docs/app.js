/* 隔夜财经速览 — 前端逻辑
 * 只读同源 news.json / quotes.json；行情走势图画布渲染；晨昏线背景；
 * 猫猫心情；重要性/主题筛选；手动/下拉刷新；localStorage 缓存与离线提示。
 */
(function () {
  'use strict';

  var NEWS_URL = 'news.json';
  var QUOTES_URL = 'quotes.json';
  var CACHE_KEY = 'overnight_news_cache_v2';
  var QCache_KEY = 'overnight_quotes_cache_v2';
  var state = { data: null, quotes: null, mood: null, persona: 'buffett', quoteIndex: 0, market: 'all', minImportance: 1, subtopic: 'all', chart: null, chartRange: 14 };

  var MARKET_LABELS = { '中国快讯': 'A股' };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function normMarket(m) { return MARKET_LABELS[m] || m || '其他'; }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var diff = Math.floor((Date.now() - d) / 60000);
    if (diff >= 0 && diff < 60) return diff + '分钟前';
    if (diff >= 60 && diff < 1440) return Math.floor(diff / 60) + '小时前';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fullTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') +
      ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ---------- 晨昏线背景 ----------
  function updateSky() {
    var h = new Date().getHours() + new Date().getMinutes() / 60;
    var sky = $('sky-bg'), sun = $('sky-sun'), stars = $('sky-stars'), horizon = document.querySelector('.sky-horizon');
    var header = document.querySelector('.app-header');
    var top, mid, bottom, horizonColor, sunColor, sunTop, starOpacity, headerGrad;
    // 参考图配色：上部冷蓝灰云层 → 中部暖金云光 → 下部蓝灰，整体柔和的黄昏天色
    if (h >= 6 && h < 9) {          // 黎明
      var t = (h - 6) / 3;
      top = mix([196, 206, 218], [186, 200, 216], t);
      mid = mix([240, 210, 178], [244, 222, 190], t);
      bottom = mix([176, 190, 204], [184, 198, 210], t);
      horizonColor = 'rgba(248,214,170,.5)'; sunColor = '#fbe3b0'; sunTop = 150 - t * 40; starOpacity = 0.1 * (1 - t);
      headerGrad = 'linear-gradient(120deg, rgba(150,170,192,.92), rgba(214,186,158,.9) 55%, rgba(176,168,172,.92))';
    } else if (h >= 9 && h < 16) {   // 白天
      top = '#c3d3e2'; mid = '#e8e0d4'; bottom = '#b6c4d2';
      horizonColor = 'rgba(255,244,224,.4)'; sunColor = '#fff8e6'; sunTop = 44; starOpacity = 0;
      headerGrad = 'linear-gradient(120deg, rgba(140,168,196,.9), rgba(200,196,186,.88) 55%, rgba(158,176,196,.9))';
    } else if (h >= 16 && h < 19) {  // 黄昏：蓝灰 + 暖金云光（贴合参考图）
      var t2 = (h - 16) / 3;
      top = '#bfd0de';
      mid = mix([240, 210, 172], [236, 190, 150], t2);
      bottom = mix([150, 168, 188], [176, 160, 170], t2);
      horizonColor = 'rgba(246,196,140,.55)'; sunColor = '#f7c491'; sunTop = 96 + t2 * 40; starOpacity = t2 * 0.12;
      headerGrad = 'linear-gradient(120deg, rgba(130,156,184,.92), rgba(212,170,132,.9) 54%, rgba(160,140,150,.92))';
    } else {                          // 夜晚：深一点的蓝灰，保留暖金余晖
      top = '#7e93a8'; mid = '#9a92a0'; bottom = '#5f7186';
      horizonColor = 'rgba(140,150,175,.35)'; sunColor = '#e8dfd0'; sunTop = 170; starOpacity = 0.4;
      headerGrad = 'linear-gradient(120deg, rgba(74,92,116,.94), rgba(120,108,124,.92) 55%, rgba(96,100,120,.94))';
      sun.style.opacity = '0.4';
    }
    if (h >= 6 && h < 19) sun.style.opacity = '1';
    var grad = 'linear-gradient(to bottom, ' + top + ' 0%, ' + mid + ' 52%, ' + bottom + ' 100%)';
    sky.style.background = grad;
    if (header) header.style.background = headerGrad;
    horizon.style.background = horizonColor;
    sun.style.background = sunColor;
    sun.style.top = sunTop + 'px';
    sun.style.boxShadow = '0 0 44px 16px ' + sunColor;
    stars.style.opacity = starOpacity;
  }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function rgb(a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; }

  // ---------- 矢量猫头（重点色布偶/暹罗风，只要头）----------
  // 蓬松奶油白脸 + 深棕面罩与耳朵 + 大蓝眼 + 粉鼻，参考图可爱风
  function renderCat(cat) {
    var S = '';
    function add(s) { S += s; }

    // 配色
    var fur = '#F4ECDF', furLight = '#FBF6ED', furShade = '#E3D6C2', furEdge = '#D8C9B0';
    var point = '#5E4636', pointDeep = '#4A3527', pointSoft = '#6E5544';
    var inner = '#E7A9AC', nose = '#D8919A', eyeIris = '#7FB0CC', eyeIrisDeep = '#5A8CA8', eyeDeep = '#31586E';

    // ---- 耳朵（深棕，重点色）----
    add('<path d="M18 50 Q14 22 20 20 Q28 20 40 34 Z" fill="' + point + '"/>');
    add('<path d="M82 50 Q86 22 80 20 Q72 20 60 34 Z" fill="' + point + '"/>');
    // 耳内绒毛
    add('<path d="M24 44 Q22 30 25 28 Q30 29 36 36 Z" fill="' + inner + '"/>');
    add('<path d="M76 44 Q78 30 75 28 Q70 29 64 36 Z" fill="' + inner + '"/>');
    // 耳尖小毛
    add('<path d="M20 22 l-3 -5 M21 20 l2 -6" stroke="' + fur + '" stroke-width="1.4" stroke-linecap="round"/>');
    add('<path d="M80 22 l3 -5 M79 20 l-2 -6" stroke="' + fur + '" stroke-width="1.4" stroke-linecap="round"/>');

    // ---- 蓬松头型：主体 + 一圈绒毛 ---- 
    // 主体
    add('<path d="M60 26 C92 26 104 48 104 68 C104 92 86 104 60 104 C34 104 16 92 16 68 C16 48 28 26 60 26 Z" fill="' + fur + '"/>');
    // 顶部绒毛高光
    add('<path d="M40 34 Q60 24 80 34 Q60 32 40 34 Z" fill="' + furLight + '" opacity=".8"/>');
    // 两侧脸颊绒毛（三角小簇，蓬松感）
    add('<path d="M16 62 l-8 -3 l7 6 l-9 2 l9 5 l-8 6 l10 2 z" fill="' + fur + '" stroke="' + furEdge + '" stroke-width=".8"/>');
    add('<path d="M104 62 l8 -3 l-7 6 l9 2 l-9 5 l8 6 l-10 2 z" fill="' + fur + '" stroke="' + furEdge + '" stroke-width=".8"/>');
    // 下巴绒毛
    add('<path d="M46 102 l-2 6 l6 -4 l3 6 l4 -6 l3 5 l4 -5 z" fill="' + fur + '"/>');

    // ---- 深棕面罩（覆盖口鼻 + 眼周，重点色标志）----
    add('<path d="M60 38 C78 38 86 50 86 64 C86 82 74 92 60 92 C46 92 34 82 34 64 C34 50 42 38 60 38 Z" fill="' + point + '" opacity=".92"/>');
    // 面罩渐变柔化边缘
    add('<ellipse cx="60" cy="70" rx="26" ry="22" fill="' + pointSoft + '" opacity=".5"/>');
    // 额头中间浅色分界（让面罩呈经典倒三角）
    add('<path d="M60 38 L52 56 Q60 62 68 56 Z" fill="' + point + '" opacity=".7"/>');

    // ---- 眼睛（大而圆，随心情）----
    if (cat === 'bull') {           // 极多：闪亮大眼 + 高光
      add('<ellipse cx="45" cy="60" rx="10" ry="11" fill="#fff"/><ellipse cx="75" cy="60" rx="10" ry="11" fill="#fff"/>');
      add('<ellipse cx="45" cy="60" rx="8" ry="9" fill="' + eyeIris + '"/><ellipse cx="75" cy="60" rx="8" ry="9" fill="' + eyeIris + '"/>');
      add('<circle cx="45" cy="61" r="4.5" fill="' + eyeDeep + '"/><circle cx="75" cy="61" r="4.5" fill="' + eyeDeep + '"/>');
      add('<circle cx="42" cy="56" r="2.6" fill="#fff"/><circle cx="72" cy="56" r="2.6" fill="#fff"/>');
      add('<circle cx="48" cy="64" r="1.4" fill="#fff"/><circle cx="78" cy="64" r="1.4" fill="#fff"/>');
    } else if (cat === 'happy') {   // 偏多：弯月笑眼
      add('<path d="M36 61 q9 -11 18 0" stroke="' + eyeDeep + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>');
      add('<path d="M66 61 q9 -11 18 0" stroke="' + eyeDeep + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>');
    } else if (cat === 'worried') { // 偏空：下垂眼 + 小高光
      add('<ellipse cx="45" cy="60" rx="9" ry="10" fill="#fff"/><ellipse cx="75" cy="60" rx="9" ry="10" fill="#fff"/>');
      add('<ellipse cx="45" cy="62" rx="6" ry="6" fill="' + eyeIris + '"/><ellipse cx="75" cy="62" rx="6" ry="6" fill="' + eyeIris + '"/>');
      add('<circle cx="45" cy="62" r="3.2" fill="' + eyeDeep + '"/><circle cx="75" cy="62" r="3.2" fill="' + eyeDeep + '"/>');
      add('<path d="M36 52 q9 3 18 0" stroke="' + pointDeep + '" stroke-width="2" fill="none" stroke-linecap="round"/>');
      add('<path d="M66 52 q9 3 18 0" stroke="' + pointDeep + '" stroke-width="2" fill="none" stroke-linecap="round"/>');
    } else if (cat === 'bear') {    // 极空：紧闭眼 + 泪光
      add('<path d="M37 58 q8 6 16 0" stroke="' + furLight + '" stroke-width="3" fill="none" stroke-linecap="round"/>');
      add('<path d="M67 58 q8 6 16 0" stroke="' + furLight + '" stroke-width="3" fill="none" stroke-linecap="round"/>');
      add('<path d="M43 68 q2 5 0 8" stroke="#8FB8CF" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
    } else {                        // calm 淡定：圆蓝眼
      add('<ellipse cx="45" cy="60" rx="9" ry="10" fill="#fff"/><ellipse cx="75" cy="60" rx="9" ry="10" fill="#fff"/>');
      add('<ellipse cx="45" cy="60" rx="7" ry="8" fill="' + eyeIris + '"/><ellipse cx="75" cy="60" rx="7" ry="8" fill="' + eyeIris + '"/>');
      add('<circle cx="45" cy="60" r="3.6" fill="' + eyeDeep + '"/><circle cx="75" cy="60" r="3.6" fill="' + eyeDeep + '"/>');
      add('<circle cx="42.5" cy="57" r="2" fill="#fff"/><circle cx="72.5" cy="57" r="2" fill="#fff"/>');
    }

    // ---- 鼻子（粉色小三角）----
    add('<path d="M56 68 q4 -3 8 0 q-4 5 -8 0 Z" fill="' + nose + '"/>');

    // ---- 嘴（随心情）----
    if (cat === 'bull') add('<path d="M54 76 q6 8 12 0" stroke="' + furLight + '" stroke-width="2.4" fill="#7a3b3b" stroke-linecap="round"/>');
    else if (cat === 'happy') add('<path d="M54 75 q6 6 12 0" stroke="' + furLight + '" stroke-width="2.3" fill="none" stroke-linecap="round"/>');
    else if (cat === 'worried') add('<path d="M54 77 q4 -3 6 0 q2 3 6 0" stroke="' + furLight + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>');
    else if (cat === 'bear') add('<ellipse cx="60" cy="78" rx="6" ry="4.5" fill="#4a2a2a"/>');
    else add('<path d="M55 75 h10" stroke="' + furLight + '" stroke-width="2.2" stroke-linecap="round"/>');

    // ---- 胡须（白色细线）----
    add('<path d="M26 70 l-14 -3 M26 76 l-14 3 M94 70 l14 -3 M94 76 l14 3" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".8"/>');

    // ---- 心情装饰 ----
    if (cat === 'bull') {
      add(heart(100, 20, 1.0, '#FF3D6E'));
      add(heart(6, 40, 0.7, '#FF7A9C'));
      add('<path d="M70 24 l1.6 4 4 .4 -3 2.8 .9 4 -3.5 -2.2 -3.5 2.2 .9 -4 -3 -2.8 4 -.4 z" fill="#FFD54A"/>');
    } else if (cat === 'happy') {
      add(heart(100, 22, 0.9, '#FF5C85'));
      add('<circle cx="18" cy="30" r="2" fill="#FFD54A"/>');
    } else if (cat === 'worried') {
      add('<path d="M100 44 q-6 10 0 14 q6 -4 0 -14 z" fill="#6FC3E8"/>');
      add('<ellipse cx="98.5" cy="50" rx="1.4" ry="2.4" fill="#cdeefb"/>');
    } else if (cat === 'bear') {
      add(poisonBottle(96, 40));
    }

    $('cat-svg').innerHTML = S;
  }

  // 矢量爱心
  function heart(x, y, scale, color) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + scale + ')">' +
      '<path d="M0 -3 C-6 -10 -14 -4 -12 3 C-10 9 0 14 0 14 C0 14 10 9 12 3 C14 -4 6 -10 0 -3 Z" fill="' + color + '"/></g>';
  }
  // 矢量毒药瓶
  function poisonBottle(x, y) {
    return '<g transform="translate(' + x + ',' + y + ')">' +
      '<rect x="-3" y="-14" width="6" height="5" rx="1" fill="#999"/>' + // 瓶盖
      '<rect x="-2" y="-10" width="4" height="3" fill="#CCC"/>' +           // 瓶颈
      '<path d="M-8 -6 Q-10 2 -8 10 Q0 14 8 10 Q10 2 8 -6 Q0 -9 -8 -6 Z" fill="#4CAF50" stroke="#2E7D32" stroke-width="1"/>' + // 瓶身
      '<path d="M-8 -6 Q0 -9 8 -6 Q0 -3 -8 -6 Z" fill="#8FE07A"/>' +       // 液面
      '<circle cx="-2" cy="3" r="2.4" fill="#fff"/>' +                       // 骷髅眼
      '<circle cx="3" cy="3" r="2.4" fill="#fff"/>' +
      '<rect x="-1" y="5" width="3" height="3" fill="#fff"/>' +              // 骷髅鼻
      '</g>';
  }

  function renderMood(mood) {
    if (!mood) return;
    state.mood = mood;
    $('mood-label').textContent = '市场多空程度';
    $('mood-cat-mood').textContent = mood.catMood + ' · ' + mood.label;
    var s = mood.score || 0;
    var pct = (s + 100) / 200 * 100;
    $('mood-fill').style.left = 'calc(' + pct + '% - 2px)';
    var scoreEl = $('mood-score');
    scoreEl.textContent = (s > 0 ? '+' : '') + s;
    scoreEl.className = 'mood-score ' + (s > 20 ? 'pos' : s < -20 ? 'neg' : 'zero');
    renderCat(mood.cat);
    updatePersona(); // 心情变了，话语也跟着更新
  }

  // ---------- 今日人格话语 ----------
  // 三种人格 × 五种心情，每人每心情 3-4 句，涵盖指引/见解/历史类比/安慰。
  // 内容为风格化模拟，非本人真实观点。
  var PERSONAS = {
    buffett: {
      name: '巴菲特',
      tag: '价值投资视角',
      bull: [
        '别人贪婪时我谨慎。今天的好消息很热闹，但请记住：价格是你付出的，价值是你得到的。',
        '市场先生今天情绪高涨，愿意为你服务——但别让他替你做决定。',
        '我从不预测市场明天涨跌，我只问：这家公司十年后还在吗？',
      ],
      happy: [
        '一点好消息值得高兴，但真正的回报来自耐心，而不是频繁按键。',
        '如果你不愿意持有十年，就别持有十分钟。今天的上涨不是卖出的理由，也不是买入的理由。',
        '风险来自你不知道自己在做什么。先弄清手里是什么，再谈涨跌。',
      ],
      calm: [
        '什么都没发生的时候，是最好的思考时间。市场先生今天没什么话要说，那就听听他沉默里的机会。',
        '我们最喜欢的持有期是永远。今天这种平淡日子，正是长期投资者的朋友。',
        '不要为每一次波动找理由。有时市场就是随机漫步，你需要的是纪律，不是故事。',
      ],
      worried: [
        '下跌给了有准备的人机会——前提是手里有现金，也有一张想买的公司清单。',
        '股价下跌并不意味着公司变差，往往只是别人情绪变了。别忘了两者区别。',
        '我只会在水温合适时下水。今天可以是观望日，观望也是一种仓位。',
      ],
      bear: [
        '别人恐惧时我贪婪——但请先确认你恐惧的是价格，还是价值真的变了。',
        '1929、1987、2008，每一次暴跌后都有人绝望，也都有人买入了好公司。历史不会简单重复，但押韵。',
        '最坏的时候，优秀企业的内在价值仍在增长。别让报价机偷走你的判断力。',
      ],
    },
    dalio: {
      name: '瑞达利欧',
      tag: '宏观周期视角',
      bull: [
        '当所有人都乐观时，更要看清债务周期处在哪个位置。繁荣本身就在孕育下一轮收紧的种子。',
        '不要被表面的强势迷惑，去检查驱动它的底层变量：信贷、生产率、政策。',
        '我的原则是：把因果链条写下来，而不是跟着情绪走。今天上涨的"因为"站得住脚吗？',
      ],
      happy: [
        '经济机器由几个简单动力驱动。今天的好转，是生产率提升还是只是流动性推动？两者持续性不同。',
        '把你的判断变成可检验的规则，然后严格执行。感觉良好不是加仓的理由。',
        '多样化配置的意义，正是在你最 confident 的时候提醒你：你可能是错的。',
      ],
      calm: [
        '现在是运行"痛苦+反思=进步"公式的好时机。市场平静时最适合复盘你的决策框架。',
        '大多数日子里什么都不会发生。真正的收益来自少数几次正确的大判断，以及长期的纪律。',
        '确保你押注的情形，是你真正理解并能承受的情形。不理解就不押。',
      ],
      worried: [
        '当去杠杆开始，现金流的确定性比收益率更重要。先活下来，再谈回报。',
        '看看三个齿轮是否还在同步转动：经济增长、通胀、政策空间。任何一个卡住都值得警惕。',
        '痛苦是不可避免的，但痛苦的程度取决于你是否有准备。今天该检查你的风险敞口了。',
      ],
      bear: [
        '历史上类似的时刻，通常是长期债务周期的尾声。央行会印钞、政府会刺激，但过程往往颠簸。',
        '不要赌单一路径。用"如果我错了怎么办"来构建你的组合，而不是"我确信会怎样"。',
        '危机中决策困难，是因为情绪劫持了理性。把原则写下来，在你冷静时就决定好该怎么做。',
      ],
    },
    xiayizhou: {
      name: '夏以昼',
      tag: '温柔陪伴视角',
      bull: [
        '今天大家都喜气洋洋的呀。开心归开心，也记得留一点清醒给自己，好不好？',
        '涨得这么好，你一定很开心吧。我陪你高兴，也陪你把节奏放慢一点。',
        '热闹的时候最容易忘形。别急，我看着呢，稳稳的就好。',
      ],
      happy: [
        '今天的风是暖的。好消息听听就好，心里有数就够了，嗯？',
        '小赚一笔很棒，但生活不只有行情。记得抬头看看窗外的天。',
        '你比昨天更从容了一点，这比任何涨跌都让我高兴。',
      ],
      calm: [
        '安安静静的一天。不看盘的时间也是生活，去喝杯热茶吧，我陪你。',
        '市场没什么动静，正好 breathing room。给自己留白，不是浪费。',
        '平稳的日子最容易被忽略，但它其实是给下一次波动攒力气呢。',
      ],
      worried: [
        '跌了呀……别慌，先深呼吸。我在呢，陪你等风停。',
        '数字跳得让人心慌，但你的价值从来不由它决定。慢慢来。',
        '今天可以不做任何决定。把手机放下，我们看会儿云，好不好？',
      ],
      bear: [
        '今天很难熬吧。没关系的，难熬的日子也会过去，我一直都在。',
        '市场也会有做噩梦的时候。别苛责自己，先抱抱自己，嗯？',
        '暴风雨里最要紧的是站稳。你已经做得很好了，剩下的交给时间。',
      ],
    },
  };

  function currentMoodKey() {
    var c = state.mood && state.mood.cat;
    return (c === 'bull' || c === 'happy' || c === 'calm' || c === 'worried' || c === 'bear') ? c : 'calm';
  }
  function updatePersona() {
    var p = PERSONAS[state.persona];
    var quotes = p[currentMoodKey()];
    state.quoteIndex = state.quoteIndex % quotes.length;
    $('persona-quote-text').textContent = quotes[state.quoteIndex];
    $('persona-quote-author').textContent = '—— ' + p.name + ' · ' + p.tag;
    $('persona-switch-name').textContent = p.name;
  }
  function nextQuote() {
    state.quoteIndex = (state.quoteIndex || 0) + 1;
    updatePersona();
  }
  var PERSONA_ORDER = ['buffett', 'dalio', 'xiayizhou'];
  function switchPersona() {
    var i = PERSONA_ORDER.indexOf(state.persona);
    state.persona = PERSONA_ORDER[(i + 1) % PERSONA_ORDER.length];
    state.quoteIndex = 0;
    updatePersona();
  }

  // ---------- 行情 ----------
  function sparkPath(history, w, h) {
    if (!history || history.length < 2) return '';
    var vals = history.map(function (p) { return p.close; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = (mx - mn) || 1;
    return vals.map(function (v, i) {
      var x = (i / (vals.length - 1)) * w;
      var y = h - ((v - mn) / span) * (h - 4) - 2;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }

  function renderQuotes(quotes) {
    var box = $('quotes-grid');
    var list = (quotes && quotes.quotes) || [];
    if (!list.length) { box.innerHTML = '<div class="empty-state">行情数据暂不可用</div>'; return; }
    box.innerHTML = list.map(function (q) {
      var dc = q.decimals == null ? 2 : q.decimals;
      var price = (q.price != null) ? (q.unit || '') + Number(q.price).toFixed(dc) : '--';
      var chg = q.changePct;
      var cls = chg == null ? 'qc-flat' : (chg > 0 ? 'qc-up' : chg < 0 ? 'qc-down' : 'qc-flat');
      var chgText = chg == null ? (q.reference ? '参考值' : '—') :
        (chg > 0 ? '+' : '') + Number(chg).toFixed(2) + '% ' + (chg > 0 ? '▲' : chg < 0 ? '▼' : '—');
      var spark = q.history && q.history.length > 1
        ? '<svg class="qc-spark" viewBox="0 0 46 20"><path d="' + sparkPath(q.history, 46, 20) +
          '" fill="none" stroke="' + (chg != null && chg < 0 ? '#16976b' : '#d92b2b') + '" stroke-width="1.5"/></svg>' : '';
      var ref = q.reference ? '<span class="qc-ref">参考</span>' : '';
      return '<div class="quote-card" data-key="' + esc(q.key) + '">' + ref +
        '<div class="qc-name">' + esc(q.name) + '</div>' +
        '<div class="qc-price">' + esc(price) + '</div>' +
        '<div class="qc-chg ' + cls + '">' + esc(chgText) + '</div>' + spark + '</div>';
    }).join('');
    // 绑定点击
    Array.prototype.forEach.call(box.querySelectorAll('.quote-card'), function (el) {
      el.addEventListener('click', function () { openChart(el.dataset.key); });
    });
  }

  // ---------- 走势图弹窗 ----------
  function openChart(key) {
    var q = (state.quotes && state.quotes.quotes || []).find(function (x) { return x.key === key; });
    if (!q) return;
    if (!q.history || q.history.length < 2) {
      $('chart-note').textContent = q.note || '该品种暂无历史走势数据' + (q.reference ? '（当前显示参考值）' : '');
    } else {
      $('chart-note').textContent = '数据来源：新浪财经 · 日线收盘价';
    }
    var dc = q.decimals == null ? 2 : q.decimals;
    var chg = q.changePct;
    $('chart-title').textContent = q.name;
    $('chart-price').innerHTML = (q.unit || '') + Number(q.price).toFixed(dc) +
      ' <span class="' + (chg > 0 ? 'qc-up' : chg < 0 ? 'qc-down' : 'qc-flat') + '">' +
      (chg == null ? '' : (chg > 0 ? '+' : '') + chg.toFixed(2) + '%') + '</span>';
    state.chart = q;
    $('chart-modal').classList.remove('hidden');
    drawChart();
  }
  function closeChart() { $('chart-modal').classList.add('hidden'); }

  function drawChart() {
    var q = state.chart; if (!q) return;
    var canvas = $('chart-canvas');
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    var hist = (q.history || []).slice(-state.chartRange);
    if (hist.length < 2) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('暂无历史走势数据', W / 2, H / 2);
      return;
    }
    var vals = hist.map(function (p) { return p.close; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pad = (mx - mn) * 0.1 || 1; mn -= pad; mx += pad;
    var pl = 6, pr = 6, pt = 12, pb = 26;
    var cw = W - pl - pr, ch = H - pt - pb;
    var up = vals[vals.length - 1] >= vals[0];
    var color = up ? '#d92b2b' : '#16976b';
    // 网格
    ctx.strokeStyle = 'rgba(148,163,184,.2)'; ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) { var gy = pt + ch * g / 3; ctx.beginPath(); ctx.moveTo(pl, gy); ctx.lineTo(W - pr, gy); ctx.stroke(); }
    // 面积
    var pts = vals.map(function (v, i) {
      return [pl + (i / (vals.length - 1)) * cw, pt + (1 - (v - mn) / (mx - mn)) * ch];
    });
    ctx.beginPath(); ctx.moveTo(pts[0][0], pt + ch);
    pts.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(pts[pts.length - 1][0], pt + ch); ctx.closePath();
    var grad = ctx.createLinearGradient(0, pt, 0, pt + ch);
    grad.addColorStop(0, up ? 'rgba(217,43,43,.18)' : 'rgba(22,151,107,.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fill();
    // 线
    ctx.beginPath(); pts.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // 末点
    var last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(last[0], last[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    // 轴标签
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(hist[0].date.slice(5), pl, H - 8);
    ctx.textAlign = 'right'; ctx.fillText(hist[hist.length - 1].date.slice(5), W - pr, H - 8);
    ctx.textAlign = 'left'; ctx.fillText(mx.toFixed(q.decimals == null ? 0 : q.decimals), pl + 2, pt + 9);
  }

  // ---------- 筛选 chips ----------
  function renderSubtopicChips(data) {
    var counts = {};
    (data.items || []).forEach(function (it) { var t = it.subtopic || '综合'; counts[t] = (counts[t] || 0) + 1; });
    var topics = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8);
    var box = $('subtopic-chips');
    var html = '<span class="subchip' + (state.subtopic === 'all' ? ' active' : '') + '" data-topic="all">全部</span>';
    html += topics.map(function (t) {
      return '<span class="subchip' + (state.subtopic === t ? ' active' : '') + '" data-topic="' + esc(t) + '">' + esc(t) + '</span>';
    }).join('');
    box.innerHTML = html;
  }

  // ---------- Feed ----------
  function importanceStars(n) {
    var h = '<span class="importance">';
    for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return h + '</span>';
  }
  function renderFeed(data) {
    var box = $('feed');
    var items = (data.items || []).filter(function (it) {
      if (state.market !== 'all' && normMarket(it.market) !== state.market) return false;
      if ((it.importance || 1) < state.minImportance) return false;
      if (state.subtopic !== 'all' && (it.subtopic || '综合') !== state.subtopic) return false;
      return true;
    });
    items.sort(function (a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0); });
    $('feed-count').textContent = '共 ' + items.length + ' 条';
    $('feed-title').textContent = (state.market === 'all' ? '全部要闻' : state.market) + ' · 时间线';
    if (!items.length) { box.innerHTML = '<div class="empty-state">当前筛选下暂无新闻</div>'; return; }
    box.innerHTML = items.map(function (it) {
      var tags = (it.impactTags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
      var url = it.sourceUrl || '#';
      return '<article class="card"><div class="card-head">' +
        '<span class="market-chip">' + esc(normMarket(it.market)) + '</span>' +
        '<span class="topic-chip-2">' + esc(it.subtopic || '综合') + '</span>' +
        importanceStars(it.importance || 1) +
        '<span class="card-time"><span class="sentiment-dot ' + (it.sentiment || 'neutral') + '"></span> ' + esc(fmtTime(it.publishedAt)) + '</span></div>' +
        '<h3 class="card-title"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></h3>' +
        '<p class="card-summary">' + esc(it.summary || '') + '</p>' +
        '<p class="card-view">' + esc(it.tradingView || '') + '</p>' +
        '<div class="tags"><span class="tag" style="background:#f5f7fa;color:var(--text-2);border-color:var(--border)">' +
        esc({ positive: '偏积极', negative: '偏谨慎', neutral: '中性' }[it.sentiment] || '中性') + '</span>' + tags +
        (url && url !== '#' ? '<a class="tag" style="text-decoration:none" href="' + esc(url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
        '</div></article>';
    }).join('');
  }

  function renderAll(news, quotes) {
    if (news) {
      state.data = news;
      $('update-time').textContent = '更新于 ' + fullTime((news.meta || {}).generatedAt) + ' · 近 ' + ((news.meta || {}).windowHours || 24) + '小时';
      renderMood(news.mood);
      renderSubtopicChips(news);
      renderFeed(news);
    }
    if (quotes) { state.quotes = quotes; renderQuotes(quotes); }
  }

  // ---------- 数据加载 ----------
  function fetchJSON(url, force) {
    return fetch(url + (force ? '?t=' + Date.now() : ''), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    });
  }
  function showBanner(msg, isError) {
    var b = $('status-banner'); b.textContent = msg; b.className = 'status-banner' + (isError ? ' error' : '');
  }
  // 轻提示 toast：刷新后明确反馈，避免用户以为没反应
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'toast'; el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function flashTimestamp() {
    var el = $('update-time');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  function loadData(force) {
    var btn = $('refresh-btn'); btn.classList.add('spinning');
    var beforeGen = state.data && (state.data.meta || {}).generatedAt;
    var startedAt = Date.now();
    Promise.all([
      fetchJSON(NEWS_URL, force).catch(function () { return null; }),
      fetchJSON(QUOTES_URL, force).catch(function () { return null; })
    ]).then(function (res) {
      var news = res[0], quotes = res[1];
      var gotNews = news && Array.isArray(news.items);
      var gotQuotes = quotes && Array.isArray(quotes.quotes);
      if (gotNews) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(news)); } catch (e) {} }
      if (gotQuotes) { try { localStorage.setItem(QCache_KEY, JSON.stringify(quotes)); } catch (e) {} }
      var cNews = gotNews ? news : safeParse(CACHE_KEY);
      var cQuotes = gotQuotes ? quotes : safeParse(QCache_KEY);
      if (cNews || cQuotes) renderAll(cNews, cQuotes);

      if (!gotNews && !cNews) {
        showBanner('数据加载失败，请检查网络', true);
        if (force) toast('刷新失败 · 请检查网络');
      } else if (!navigator.onLine) {
        showBanner('当前离线，展示缓存数据（可能非最新）', true);
        if (force) toast('离线中 · 展示缓存数据');
      } else {
        showBanner('');
        if (force) {
          // 至少转一圈再提示，视觉上更像"真的刷新了"
          var wait = Math.max(0, 450 - (Date.now() - startedAt));
          setTimeout(function () {
            var newGen = cNews && (cNews.meta || {}).generatedAt;
            if (newGen && beforeGen && newGen !== beforeGen) {
              toast('已更新至 ' + fullTime(newGen));
              flashTimestamp();
            } else {
              toast('已是最新 · 每日 7:30 自动更新');
              flashTimestamp();
            }
          }, wait);
        }
      }
    }).finally(function () { btn.classList.remove('spinning'); });
  }
  function safeParse(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  // ---------- 交互 ----------
  $('refresh-btn').addEventListener('click', function () { loadData(true); });
  $('update-time').addEventListener('click', function () { loadData(true); }); // 顶部"更新于"也可点

  // 人格切换（循环按钮）
  $('persona-switch').addEventListener('click', switchPersona);
  // 点话语卡 / 点猫猫 都换一句
  $('persona-quote').addEventListener('click', nextQuote);
  $('cat-svg').addEventListener('click', nextQuote);
  $('persona-quote').style.cursor = 'pointer';
  $('cat-svg').style.cursor = 'pointer';
  $('chart-close').addEventListener('click', closeChart);
  $('chart-modal').addEventListener('click', function (e) { if (e.target === $('chart-modal')) closeChart(); });
  $('chart-tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.chart-tab'); if (!t) return;
    document.querySelectorAll('.chart-tab').forEach(function (x) { x.classList.remove('active'); });
    t.classList.add('active'); state.chartRange = parseInt(t.dataset.range, 10); drawChart();
  });
  window.addEventListener('resize', function () { if (!$('chart-modal').classList.contains('hidden')) drawChart(); });

  $('market-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab'); if (!tab) return;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active'); state.market = tab.dataset.market;
    if (state.data) renderFeed(state.data);
  });
  $('importance-range').addEventListener('input', function (e) {
    state.minImportance = parseInt(e.target.value, 10);
    $('importance-value').textContent = state.minImportance <= 1 ? '全部' : '≥' + state.minImportance + '星';
    if (state.data) renderFeed(state.data);
  });
  $('subtopic-chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.subchip'); if (!chip) return;
    state.subtopic = chip.dataset.topic;
    Array.prototype.forEach.call($('subtopic-chips').children, function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
    if (state.data) renderFeed(state.data);
  });

  // 下拉刷新
  var startY = 0, pulling = false, indicator = $('pull-indicator');
  window.addEventListener('touchstart', function (e) { if (window.scrollY <= 0) startY = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var dy = e.touches[0].clientY - startY;
    if (window.scrollY <= 0 && dy > 60) { pulling = true; indicator.classList.add('show'); indicator.textContent = dy > 110 ? '释放立即刷新' : '下拉刷新'; }
  }, { passive: true });
  window.addEventListener('touchend', function () { if (pulling) { indicator.classList.remove('show'); loadData(true); } pulling = false; });

  // 定时更新晨昏线（每 10 分钟）
  updateSky(); setInterval(updateSky, 600000);

  // Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  // 启动：先渲染缓存
  updatePersona(); // 初始填满话语框
  var cNews = safeParse(CACHE_KEY), cQuotes = safeParse(QCache_KEY);
  if (cNews || cQuotes) renderAll(cNews, cQuotes);
  loadData(false);
})();
