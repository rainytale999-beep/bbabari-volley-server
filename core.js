'use strict';
/* ===== 빱알이 배구 — 코어(2.5D 물리·규칙·AI). 브라우저/노드 공용 =====
   좌표: x = 코트 길이 방향(네트가 x=640), z = 깊이(0 안쪽 ~ ZD 바깥쪽/카메라 쪽), y = 화면 높이(GY가 바닥) */
const W = 1280, H = 720, GY = 620, NETH = 178, NETW = 14, BR = 26, NETTOP = GY - NETH;
// 코트 크기는 팀 인원에 따라 달라진다(사람이 많을수록 넓어서 빈 곳이 생긴다). CW = 코트 전체 길이, ZD = 깊이, XS = 1:1 대비 길이 배율
const COURTS = { 1: [1408, 374], 2: [1650, 451], 3: [1892, 517] }; // v0.35: 모두 10% 크게(전: 1280×340, 1500×410, 1720×470)
const SRV = 695; // 서브 자리: 끝선 뒤(코트 밖). 네트로부터의 거리(1:1 기준)
const OUT = { spk: 0.005, tec: 0.006, strong: 0.015, full: 0.03, deep: 0.02, side: 0.01, late: 0.05, heat: 0.025, recv: 0.015, hard: 0.06, stag: 0.13, dive: 0.05, over: 0.008, overHard: 0.06, toss: 0.004 }; // v0.41 공이 코트 밖으로 나가는 확률(스파이크는 합산, 리시브·토스는 상황별)
const SERVE_OUT_P = 0.3; // 게이지를 가득 채운 강서브가 끝선 밖으로 나가 버릴 확률
const STA = { rest: 1.5, idle: 0.9, run: 2.0, walk: 0.7, serve: 2.0, act: 1.05 }; /* v1.33 체력 소모 늘림(전: rest 1.8 idle 1.1 run 1.5 walk 0.5 serve 2.5 act 0.8) */ // act = 동작(점프·스파이크 등) 소모 배율 // 체력 회복(랠리 사이·가만히)과 소모(달리기·걷기) 초당 양, 서브 때 회복량
const DIRECT_MISS = 0.5;
const BLK_N = { 1: 1, 2: 0.85, 3: 0.6 }; // 인원별 PC 블로킹 시도 배율(인원마다 네트 앞 상황이 달라 따로 맞춘다) // 다이렉트(상대가 넘긴 공을 바로 스파이크)가 헛스윙이 되는 확률
const MOVE_K = 1; // 걷기·달리기 속도 배율(v0.32 0.92 → v0.34 다시 1: 체력이 떨어지면 저절로 느려지므로)
const BALL_K = 0.9; // 스파이크·강서브처럼 곧게 날아가는 공의 속도 배율(v0.34 10% 느리게)
const DIVE_LEN = 150; // 슬라이딩 리시브 최대 거리(1:1 기준). 세네 ×1.25, 눈밭·빙판 ×1.3
let CW = 1280, NETX = 640, ZD = 340, XS = 1, VW = 1460; // VW = 화면에 보이는 폭(코트 + 양쪽 끝선 뒤 여유)
function useCourt(n) { const c = COURTS[n] || COURTS[1]; CW = c[0]; NETX = CW / 2; ZD = c[1]; XS = CW / 1280; VW = CW + 180 * XS; }
const GB = 1300, GP = 2300, DT = 1 / 60; // GB 공 중력(v0.34: 1400 → 1300, 띄운 공이 조금 천천히)
const K = { L: 1, R: 2, U: 4, D: 8, A: 16, S: 32, X: 64, I: 128 }; // I: 아이템 사용(F)

const CHARS = [
  { id: 'bbabjji', name: '빱찌', title: '치즈 도둑 아이돌', spd: 4, jmp: 3.5, pow: 2.5, tec: 3.5, gut: 2.5, type: 'instant', sup: 'ufo',
    supName: '빱알이 우주선 호출', supDesc: '빱알이 우주선이 날아와 공을 납치한다. 상대 코트 위에서 "어디 떨굴까~" 하고 약 올리다가 냅다 수직 투하. 깔리면 납작해진다. 돌아가는 길에 상대 통장(필살 게이지)도 털어 간다. 떨어질 자리에서 나이스로 받아 내면 우주선이 폭파돼 3점 동안 필살기를 못 쓴다.',
    pasName: '바둥바둥', pasDesc: '넘어져도 금방 일어난다. 넘어진 채 바둥거리는 발에 공이 맞으면 가끔 그게 또 리시브가 된다.' },
  { id: 'goseum', name: '고슴도치', title: '빱알이 대장', spd: 2.5, jmp: 3, pow: 4.5, tec: 2.5, gut: 3, type: 'spike', sup: 'thorn',
    supName: '엉덩이 추적 가시공', supDesc: '공에 가시와 성난 눈썹이 돋아나 가장 가까운 상대의 엉덩이를 끝까지 쫓아간다. 찔리면 "앗 따가!" 하며 엉덩이를 잡고 폴짝폴짝. 상대 바닥에도 가시가 깔린다(2점 동안).',
    pasName: '대장의 가시 장벽', pasDesc: '블로킹 범위가 넓고, 막은 공이 더 세게 튕겨 나간다.' },
  { id: 'barcode', name: '바코드', title: '걸어다니는 계산대', spd: 3, jmp: 2.5, pow: 3, tec: 5, gut: 3, type: 'spike', sup: 'bogo',
    supName: '삑! 2+1 행사', supDesc: '공이 세 개로 늘어난다. 진짜는 하나, 나머지 둘은 사은품 두루마리 휴지. 휴지를 받은 사람은 민망해서 굳는다. "행사 종료되었습니다."',
    pasName: '정밀 스캔', pasDesc: '토스와 리시브가 빗나가지 않는다. 우리 코트 낙하 지점에는 "여기!" 가격표까지 붙는다.' },
  { id: 'sene', name: '세네', title: '안테나 서너 개', spd: 4.5, jmp: 3, pow: 2.5, tec: 4, gut: 2.5, type: 'instant', sup: 'puppet',
    supName: '리모컨 해킹', supDesc: '안테나로 상대 전원을 1점 동안 해킹한다. 상대는 세네가 움직이는 대로 거울처럼 따라 움직일 수밖에 없다. 세네가 점프하면 다 같이 점프한다. (당한 쪽은 ← →를 번갈아 빠르게 누르면 풀린다)',
    pasName: '더듬이 감지', pasDesc: '다이빙 리시브 거리가 길다.' },
  { id: 'dalgareum', name: '달가름', title: '문워크 장인', spd: 3, jmp: 4.5, pow: 3.5, tec: 3.5, gut: 2.5, type: 'instant', sup: 'float',
    supName: '달나라 관광', supDesc: '달을 반으로 쩍 갈라 상대 코트의 중력을 꺼 버린다. 상대 전원이 둥실 떠올라 허우적대고, 끝나면 엉덩방아를 찧는다. (당한 쪽은 ← →를 번갈아 빠르게 누르면 일찍 내려온다)',
    pasName: '저중력 체질', pasDesc: '점프가 높고 체공 시간이 길다. 착지한 뒤 잠깐 빨라진다.' },
  { id: 'jiae', name: '지애수이시보', title: '리본 체조 국가대표(자칭)', spd: 3, jmp: 4, pow: 2, tec: 4, gut: 3, type: 'instant', sup: 'wrap',
    supName: '돌돌말이 김밥', supDesc: '리본으로 공 근처의 상대 둘을 김밥처럼 돌돌 만다. 말린 상대는 통통 튀는 것 말고는 아무것도 못 한다. (1:1이면 한 줄)',
    pasName: '리본 리치', pasDesc: '리시브·토스가 닿는 범위가 넓다.' },
  { id: 'bami', name: '밤이도', title: '밤송이 헬멧', spd: 2, jmp: 2.5, pow: 4, tec: 3, gut: 4, type: 'spike', sup: 'hot',
    supName: '군밤 폭탄 돌리기', supDesc: '공이 심지 달린 군밤 폭탄이 된다. 3초 뒤 터지는데, 터질 때 공이 있는 쪽 코트 전원이 새까맣게 그을려 날아간다. 우리 쪽으로 돌아오면 우리가 터진다.',
    pasName: '밤송이 헤딩', pasDesc: '강한 공을 머리로 맞아도 안 넘어진다. 오히려 머리로 받는 게 더 정확하다.' },
  { id: 'mandu', name: '만두의코고는소리', title: '자면서 배구하는 만두', spd: 2, jmp: 2.5, pow: 4.5, tec: 3, gut: 4, type: 'instant', sup: 'snore',
    supName: '드르렁 자장가', supDesc: '코 고는 소리로 상대 전원을 재운다. 공에 맞으면 콧물 풍선이 터지며 깬다. 문제는 본인도 잠깐 잔다는 것.',
    pasName: '낮잠 충전', pasDesc: '가만히 서 있으면 필살 게이지가 저절로 찬다.' },
  { id: 'iseu', name: '이스', title: '머리 위의 각얼음', spd: 3.5, jmp: 3.5, pow: 3, tec: 3.5, gut: 2.5, type: 'spike', sup: 'ice',
    supName: '꽁꽁 스파이크', supDesc: '얼음공 발사. 받은 사람은 얼음 동상이 되어 컬링 스톤처럼 미끄러져 가고, 상대 코트 바닥은 빙판이 된다.',
    pasName: '쿨한 성격', pasDesc: '스턴·넘어짐 같은 상태 이상이 절반만 지속된다.' },
  // v0.38 신규 6명 (능력치 합 16)
  { id: 'chiwa', name: '만두', title: '덜덜 떠는 치와와', spd: 4.5, jmp: 4, pow: 2.5, tec: 3, gut: 3, type: 'instant', sup: 'giant',
    supName: '거대 치와와 멍멍 펀치', supDesc: '펑! 하고 거대 치와와로 변신(12초). 몸이 커지고 더 빠르고 높이 뛴다. 짖을 때마다 화면이 흔들리고, 이때 스파이크는 받는 사람을 쓰러뜨리는 앞발 스파이크. 끝나면 "깨갱…" 하고 더 작게 쪼그라들어 덜덜 떤다.',
    pasName: '덜덜 꼬마', pasDesc: '몸집이 작아 강한 공에 몸으로 맞는 판정이 작다.' },
  { id: 'mungbek', name: '멍베크', title: '흙땅콩 시바 모자', spd: 3.5, jmp: 3, pow: 3, tec: 3.5, gut: 3, type: 'instant', sup: 'net',
    supName: '춤추는 네트', supDesc: '네트에 눈·입·다리가 생겨 자리를 옮긴다. 우리가 토스하면 네트가 공 뒤로 달려가 공이 상대 코트에 떨어지고, 상대가 넘기려는 공은 네트가 마중 나가 막는다. (한 번 쓰면 끝, 최대 12초)',
    pasName: '킁킁 추적', pasDesc: '상대가 넘긴 공을 쫓을 때 12% 빨라진다.' },
  { id: 'midwae', name: '미돼', title: '엄마 껌딱지 돼지', spd: 2.5, jmp: 2.5, pow: 4, tec: 2.5, gut: 4.5, type: 'spike', sup: 'mom',
    supName: '엄마 돼지 출동', supDesc: '"엄마아~!" 하고 공을 살짝 넘기면, 상대 코트 뒤 땅에서 파마머리 엄마 돼지가 솟아올라 "누가 우리 애 울렸어!" 하며 상대 코트 앞쪽으로 강스파이크.',
    pasName: '꿀꿀 저금통', pasDesc: '우리 팀이 점수를 낼 때마다 필살 게이지가 더 찬다.' },
  { id: 'banban', name: '반반', title: '흑백 반쪽 백작', spd: 3, jmp: 3, pow: 3.5, tec: 3.5, gut: 3, type: 'instant', sup: 'half',
    supName: '반띵 저주', supDesc: '흑백 소용돌이로 8초 동안 상대 전원의 크기·속도·점프·손 닿는 거리·스파이크 힘을 모두 절반으로. 목소리도 "삐약".',
    pasName: '흑백 교대', pasDesc: '서브할 때마다 흰색(리시브 정확도↑)과 검은색(스파이크 힘↑)이 번갈아 바뀐다.' },
  { id: 'snurse', name: '스너스', title: '응급실 에이스', spd: 3, jmp: 3, pow: 2, tec: 4, gut: 4, type: 'instant', sup: 'heal',
    supName: '링거 대잔치', supDesc: '거대 주사기가 "뿅!" 날아와 우리 편 전원 체력 가득, 다른 우리 편 필살 게이지 절반 충전(본인은 0%), 상대편의 필살기 게이지 조금 감소, 3초 동안 "기운 펄펄!" 빨라진다.',
    pasName: '응급처치', pasDesc: '근처 우리 편이 넘어지면 빨리 일어난다. 랠리 사이 체력 회복 2배. 리시브가 닿는 범위가 조금 넓다.' },
  { id: 'darai', name: '다라이트', title: '고무 대야 수비대장', spd: 2.5, jmp: 3, pow: 2.5, tec: 3, gut: 4.5, type: 'instant', sup: 'basin',
    supName: '고무 다라이 철벽', supDesc: '고무 다라이가 숨어서 기다리다가, 상대 공이 네트를 넘어오면(스파이크·서브·살짝 넘긴 공 모두) 휙 날아와 "퉁!" 하고 1번 무조건 막는다. 막은 다라이는 튕겨 나가 사라진다(20초 안에 공격이 없으면 그냥 사라짐).',
    pasName: '튼튼 다라이', pasDesc: '강한 공에 맞아도 넘어지지 않고 "텅!" 하며 잠깐 멈칫한다.' },
];
const STAGES = [
  { id: 'beach', tip: '모래가 푹신해서 다이빙 후 금방 일어나요. 가끔 파도에 젖으면 느려져요.', name: '백사장', g: 1, desc: '기본 코트. 모래가 푹신해서 다이빙 후 금방 일어난다.' },
  { id: 'gym', tip: '천장이 낮아서 높이 띄운 공이 천장·벽에 튕겨요.', name: '실내경기장', g: 1, ceil: 120, desc: '천장이 낮다. 높이 띄운 공이 천장과 벽에 팅팅 튕긴다.' },
  { id: 'planet', tip: '중력이 약해서 높이 뛰고 공도 천천히 떨어져요. 가끔 무중력 돌풍이 불어요.', name: '외계의 별', g: 0.74, desc: '치즈별은 저중력. 높이 뛰고 공도 천천히 떨어진다.' },
  { id: 'river', tip: '서브 때마다 불어오는 방향이 바뀌는 바람이 공을 밀어내요.', name: '강변', g: 1, windy: 1, desc: '강바람이 분다. 서브 때마다 풍향이 바뀌니 풍향계를 볼 것.' },
  { id: 'snow', tip: '눈밭이라 미끄러워요. 멈출 때 주르륵 밀리고 다이빙이 멀리 나가요.', name: '눈마을', g: 1, slip: 1, desc: '눈밭이라 미끄럽다. 멈출 때 주르륵 밀리고 다이빙이 멀리 나간다.' },
  { id: 'market', tip: '아이템이 훨씬 자주 나와요. 가끔 떨이 세일로 두 개가 한꺼번에!', name: '야시장', g: 1, fest: 1, desc: '축제의 밤. 아이템이 훨씬 자주 나온다.' },
  { id: 'bath', tip: '가끔 수증기가 코트를 가려요. 젖은 타일이라 살짝 미끄러워요.', name: '목욕탕', g: 1, wet: 1, steam: 1, desc: '대중목욕탕. 가끔 수증기가 코트를 가리고, 젖은 타일이라 살짝 미끄럽다.' },
  { id: 'roof', tip: '가끔 비둘기가 날아와 공을 쳐서 방향을 바꿔 놓아요.', name: '옥상', g: 1, pigeon: 1, desc: '노을 지는 옥상. 가끔 비둘기가 날아와 공을 "퍽!" 친다.' },
  { id: 'candy', tip: '말랑한 젤리 바닥이라 점프가 더 높아요.', name: '과자 나라', g: 1, jelly: 1, desc: '젤리 바닥이라 점프가 높고 통통 튄다.' },
  { id: 'volcano', tip: '화산이 쿠웅! 하면 군고구마가 떨어져요. 바닥 그림자를 피하세요.', name: '화산섬', g: 1, quake: 1, desc: '가끔 화산이 쿠웅! 하늘에서 군고구마가 떨어진다. 그림자를 피할 것.' },
];
const ITEMS = [
  { id: 'cheese', name: '치즈', desc: '내 필살기 게이지 +50' }, // v0.51 아이템 리뉴얼: 바닥에서 주워 원할 때(F) 사용
  { id: 'big', name: '거대화 우유', desc: '8초 동안 내가 커진다(블로킹·스파이크 강해짐)' },
  { id: 'fast', name: '번개 신발', desc: '6초 동안 우리 팀 전원 아주 빨라짐' },
  { id: 'mini', name: '꼬꼬마 버섯', desc: '6초 동안 상대 전원이 작아진다' },
  { id: 'banana', name: '바나나', desc: '상대 코트에 바나나 껍질 4개 투척' },
  { id: 'balloon', name: '풍선공', desc: '4초 동안 공이 둥실둥실 느려진다(수비용)' },
  { id: 'heal', name: '체력 도시락', desc: '우리 팀 체력 +60, 넘어진 사람 바로 일어남' },
];
// v0.45 필살기 상성(가위바위보): 수비형 > 공격형 > 방해형 > 수비형. 상대 컷인 중에 D로 맞받으면 '필살기 대결'
const SCAT = { goseum: 'atk', barcode: 'atk', bami: 'atk', iseu: 'atk', midwae: 'atk', sene: 'dis', dalgareum: 'dis', jiae: 'dis', mandu: 'dis', banban: 'dis', bbabjji: 'def', chiwa: 'def', mungbek: 'def', snurse: 'def', darai: 'def' };
const CATN = { atk: '공격형', dis: '방해형', def: '수비형' }, BEATS = { def: 'atk', atk: 'dis', dis: 'def' };
for (const c of CHARS) c.cat = SCAT[c.id];
const DIFFS = {
  easy:   { name: '쉬움',   react: 0.42, err: 48, block: 0,    dive: 0.15, perf: 0,    two: 0,    sup: 0.4, chg: 0,   miss: 0.5, counter: 0, dig: 0 },
  normal: { name: '보통',   react: 0.27, err: 24, block: 0.26, dive: 0.46, perf: 0.08, two: 0.12, sup: 0.8, chg: 0.5,  miss: 0.3,  counter: 0.25, dig: 0.2 }, // v1.33 아주 조금 더 쉽게(v1.30: react 0.25 err 22 block 0.28 dive 0.5 perf 0.09 two 0.13 chg 0.52 miss 0.26 counter 0.27 dig 0.22 — 이제 v1.16 이전 값과 거의 같음). v1.30 살짝 쉽게(v1.16 값과 그 전 값의 중간쯤: react 0.23 err 20 block 0.3 dive 0.55 perf 0.1 two 0.14 chg 0.55 miss 0.22 counter 0.3 dig 0.25) // v1.16 더 어렵게(전: react 0.27 err 24 block 0.27 dive 0.45 perf 0.08 two 0.12 chg 0.5 miss 0.3 counter 0.25)
  hard:   { name: '어려움', react: 0.12, err: 7,  block: 0.5,  dive: 0.88, perf: 0.3,  two: 0.34, sup: 1,   chg: 1,   miss: 0.08, counter: 0.7, dig: 0.45 }, // v1.16 더 어렵게(전: react 0.15 err 9 block 0.45 dive 0.8 perf 0.25 two 0.3 miss 0.12 counter 0.6)
  hell:   { name: '지옥',   react: 0.07, err: 3,  block: 0.6,  dive: 0.95, perf: 0.45, two: 0.45, sup: 1,   chg: 1,   miss: 0.04, counter: 0.9, dig: 0.6 }, // v1.06 가장 어려움: 반응·정확도·블로킹·빈자리 공격 최상
};
// 팀 인원별 기본 위치 [네트로부터 거리, 깊이 비율]
const SPK_CHG = 0.6, SPK_HOLD = 0.5, SPK_POW = 1.0; // v1.16 강스파이크 어렵게(전: 힘 모으기 0.42초, 꽉 찬 뒤 0.9초 버팀, 힘 0.9 넘으면 강타)
const RCV_K = 0.9; // v1.16 사람의 리시브(상대 공 받기) 손 닿는 거리 10% 줄임(모든 난이도)
const AIR_K = 0.8, AIR_R = 250, AIR_ZK = 0.55, AIR_LEAD = 0.13, /* v1.39 스파이크 점프 때 공 쪽으로 더 잘 따라감(전: 0.62·215, 앞뒤 0.3, 앞서 보기 0.1초) */ DEP_K = 0.29, DEP_R = 150, DEP_AIR = 0.34, DIV_K = 0.5; // v1.31 리시브·스파이크 자동 이동 살짝 더(전: 0.55·200, 깊이 0.25·140·공중 0.3) // v1.22 자동 따라가기 더 약하게(공중 앞뒤 끌기는 ak의 30%; v1.21: 공중 0.8·260, 깊이 0.5·190·공중 0.65 / v1.20: 1.0·320, 0.62·230·0.8, 다이빙은 공 쪽으로 100%)
const CTRLS = { // 조작 난이도
  easy: { name: '쉬움', desc: '깊이 자동 맞춤 강하게 · 판정 넉넉 · 꾹 누르고 있으면 알아서 스파이크 · 버튼 안내', zk: 0.55, reach: 1.14, assist: 1.3, perf: 0.12, auto: true, buf: 0.18 } /* v1.16 perf 0.15→0.12, buf 0.22→0.18 */,
  normal: { name: '보통', desc: '깊이 자동 맞춤 · 버튼 안내. 스파이크 타이밍은 직접 맞춘다', zk: 0.63, reach: 1.05, assist: 1.12, perf: 0.08, auto: false, buf: 0.14 } /* v1.16 perf 0.1→0.08, buf 0.18→0.14 */, // v0.23: 조금 쉽게(전: zk 0.68, reach 1, assist 1, perf 0.075, buf 0.16)
  pro: { name: '수동', desc: '도움 없음. 앞뒤 위치와 타이밍을 전부 직접 맞춘다(버튼 안내도 꺼짐)', zk: 1, reach: 1, assist: 0, perf: 0.06, auto: false, buf: 0 } /* v1.16 perf 0.075→0.06 */,
};
/* v0.64 도핑: 로비에서 시작 전에 한 번 누르면 능력치가 무작위로 바뀐다. 50% = 모든 능력치 별 0.5칸(0.5~10칸). [별 변화, 확률%] — 나머지는 그대로 */
const DOPE_T = [[0.2, 2], [0.15, 4], [0.1, 6], [0.05, 8], [-0.05, 25], [-0.1, 15]]; // v1.36 변동폭 절반: -10%~+20%(전 -20%~+40%). v1.05 범위 -20%~+40%(100% = 능력치 1칸): 좋아짐 20%(+40% 2%), 그대로 40%, 나빠짐 40%
function rollDope() { let r = Math.random() * 100; for (const [d, pc] of DOPE_T) { if (r < pc) return d; r -= pc; } return 0; }
function dopeLabel(d) { return d ? (d > 0 ? '+' : '') + Math.round(d * 100) + '%' : '그대로'; }
const DOPED = {};
function chOf(p) { const c = CHARS[p.ch], d = p.dope; if (!d) return c; const k = p.ch + '|' + d; if (!DOPED[k]) { const o = Object.assign({}, c), f = v => Math.max(0.5, Math.min(10, v + d)); /* 0.5~10칸 */ o.spd = f(c.spd); o.jmp = f(c.jmp); o.pow = f(c.pow); o.tec = f(c.tec); o.gut = f(c.gut); DOPED[k] = o; } return DOPED[k]; } // 그 선수의 실제 능력치(도핑 반영)
function supHow(ch) { return CHARS[ch].type === 'instant' ? 'D를 누르면 바로 발동' : '점프해서 공 가까이에서 D'; }
function ctl(S, p) { return CTRLS[S.ctrl] || CTRLS.normal; } // 판정(거리·깊이)은 PC와 사람이 같다. 자동 맞춤·자동 스파이크 같은 도움만 사람 전용
const HOMES = { 1: [[330, 0.5]], 2: [[170, 0.34], [440, 0.66]], 3: [[150, 0.5], [430, 0.24], [430, 0.76]] };

function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function fdir(p) { return p.team === 0 ? 1 : -1; }
function netD(team, d) { return team === 0 ? NETX - d * XS : NETX + d * XS; } // 거리는 1:1 코트 기준으로 적고, 코트가 넓으면 같이 늘어난다
function oppD(team, d) { return team === 0 ? NETX + d * XS : NETX - d * XS; }
function sideOf(x) { return x < NETX ? 0 : 1; }
function psc(p) { const s = p.st || {}; return (p.big > 0 ? 1.4 : 1) * (p.mini > 0 ? 0.62 : 1) * (s.giant > 0 ? 2.2 : 1) /* v1.31 1.9→2.2 */ * (s.shrink > 0 ? 0.55 : 1) * (s.half > 0 ? 0.5 : 1); }
function busy(p) { const s = p.st; return s.down > 0 || s.stun > 0 || s.hop > 0 || s.sleep > 0 || s.frozen > 0; }
function cool(p) { return chOf(p).id === 'iseu' ? 0.4 : 1; }
function tq(c) { return 3 + (c.tec - 3) * 0.75; } // v0.50 기술 1칸 효과(승률 영향이 너무 커서 0.75배)
function gutMul(p) { return (1 + (3 - chOf(p).gut) * 0.17) * cool(p); } // v0.37: 능력치 차이를 더 크게(맷집 1 → 1.3배, 5 → 0.7배)
function fat(p) { return 0.78 + 0.22 * clamp(p.hp, 0, 100) / 100; } // 체력이 떨어질수록 능력치가 내려간다(체력 0이면 78%)
function tire(p, amt, mv) { if (p.ko || p.hp <= 10) return; p.hp = Math.max(10, p.hp - amt * (mv ? 1 : STA.act) * (0.97 + (3 - chOf(p).gut) * 0.09)); } // 움직이고 치는 데 드는 체력. 근성이 높으면 덜 지친다. 이것만으로는 10 아래로 안 내려간다
function pSpeed(S, p) {
  const c = chOf(p), s = p.st;
  return (385 + (c.spd - 3) * 14) * MOVE_K * roleK(p, 'spd') * (p.fast > 0 ? 1.4 : 1) * (s.sad > 0 ? 0.62 : 1) * (s.wrap > 0 ? 0.3 : 1) * (s.moon > 0 ? 1.3 : 1) * (s.giant > 0 ? 1.28 : 1) /* v1.15 거대 치와와는 빠르다(v1.31 1.2→1.28) */ * (s.wet2 > 0 ? 0.7 : 1) * (p.ck || 1) * (S.env.slip ? 1 + 0.2 * (p.mom || 0) : 1) * (p.mini > 0 ? 1.08 : 1) * (p.big > 0 ? 0.92 : 1) * fat(p) * (s.half > 0 ? 0.5 : 1) * (p.tis > 0 ? 0.7 : 1) * (s.boost > 0 ? 1.25 : 1) * (s.giant > 0 ? 0.92 : 1)
    * (c.id === 'mungbek' && S.ball && !S.ball.held && S.ball.lastTeam >= 0 && S.ball.lastTeam !== p.team ? 1.12 : 1);
}
function pGrav(S, p) { return GP * (p.act === 'block' && S.env.g < 1 ? 1 : S.env.g) * (chOf(p).id === 'dalgareum' ? 0.76 : 1) * (S.env.jelly ? 0.86 : 1); } // 과자 나라: 젤리 바닥이라 높이 뜬다
const ROLES = { // v0.98 역할: 비슷한 실력이면 역할을 잘 해내는 쪽이 이긴다(2대2·3대3, 1대1은 만능)
  all: { name: '만능', short: '만', icon: '⭐', desc: '능력 그대로', up: ['모든 능력 그대로'], down: [] },
  libero: { name: '리베로', short: '리', icon: '🧤', desc: '수비 잘함 / 공격·점프↓', up: ['받기 범위 +20%', '리시브 정확 +40%', '다이빙 +25%', '강타를 55% 버팀'], down: ['스파이크 힘 -20%', '점프 -12%'] },
  setter: { name: '세터', short: '세', icon: '🙌', desc: '토스 잘함 / 공격·리시브↓', up: ['토스 정확 +50%', '내 토스로 동료 스파이크 +20%', '이동 속도 +8%'], down: ['스파이크 힘 -15%', '리시브 -10%'] },
  spiker: { name: '스파이커', short: '스', icon: '💥', desc: '공격 잘함 / 받기↓', up: ['스파이크 힘 +18%', '점프 +10%', '스파이크 아웃 -25%', '블로킹 +15%'], down: ['받기 범위 -15%', '리시브 -20%'] } }; // v1.02 한쪽 능력에 크게 몰아준다(v1.36 변동폭 절반으로)
const RK = { libero: { reach: 1.2, rcv: 1.4, dive: 1.25, tough: 0.55, spk: 0.8, jmp: 0.88, blk: 0.8 }, setter: { toss: 1.5, setb: 1.2, spd: 1.08, spk: 0.85, rcv: 0.9 }, spiker: { spk: 1.18, jmp: 1.1, out: 0.75, blk: 1.15, reach: 0.85, rcv: 0.8 } }; // v1.36 변동폭 절반(전: 리베로 reach 1.4 rcv 1.8 dive 1.5 tough 0.8 spk 0.6 jmp 0.75 blk 0.6 / 세터 toss 2 setb 1.4 spd 1.15 spk 0.7 rcv 0.8 / 스파이커 spk 1.35 jmp 1.2 out 0.5 blk 1.3 reach 0.7 rcv 0.6)
function roleK(p, k) { const r = RK[roleOf(p)]; return r && r[k] != null ? r[k] : 1; }
function roleOf(p) { return p && p.role && ROLES[p.role] ? p.role : 'all'; }
function powV(c) { return 1155 + (c.pow - 3) * 200; } // 파워 → 스파이크·강서브 공 속도(파워 3 = 예전과 같음)
function jumpV(p) { return (914 + (chOf(p).jmp - 3) * 80) * roleK(p, 'jmp') * (1 + ((p.ck || 1) - 1) * 0.5) * (0.9 + 0.1 * clamp(p.hp, 0, 100) / 100) * (p.st && p.st.half > 0 ? 0.75 : 1) * (p.st && p.st.giant > 0 ? 1.15 : 1); } /* v1.31 1.1→1.15 */ // v1.15 거대 치와와는 더 높이
function jumpH(S, p) { const v = jumpV(p); return v * v / (2 * pGrav(S, p)); }
function ballG(S, b) { return GB * S.env.g * (b.float > 0 ? 0.5 : 1); }
function heat(S) { return clamp(((S.rallyHits || 0) - 5) * 0.065, 0, 0.65); } // v0.38: 랠리가 길어지면 공이 빨라진다(6번째 터치부터 한 번에 +6.5%, 최대 +65%)
function ballPrs(b) { if (b.sup) return 1; const v = Math.hypot(b.vx, b.vz) + Math.max(0, b.vy) * 0.6; return clamp((v - 480) / 900, 0, 1); } // 공격 세기 0(살짝 넘긴 공)~1(풀파워·필살기)
function prsK(S, p) { const b = S.ball, low = b.vy > 0 ? 0.8 + 0.2 * clamp((GY - b.y - 20) / 130, 0, 1) : 1; return (b.lastTeam >= 0 && b.lastTeam !== p.team ? 1.22 - 0.4 * (b.prs || 0) : 1) * low; } // 떨어지는 공이 바닥에 가까울수록 닿는 범위가 줄어든다(최대 20%) // 상대가 보낸 공: 약하면 넉넉히(1.22배), 강하면 빠듯하게(0.82배) 닿는다
function ev(S, k, x, y, z, a, b) { S.ev.push([S.evId++, k, Math.round(x || 0), Math.round(y || 0), Math.round(z || 0), a === undefined ? 0 : a, b === undefined ? 0 : b]); }
function d3(ax, ay, az, bx, by, bz) { return Math.hypot(ax - bx, ay - by, az - bz); }

function mkPlayer(i, cfg, n) {
  const team = i < n ? 0 : 1, slot = i % n, h = HOMES[n][slot];
  return { i, team, slot, ch: cfg.ch, name: cfg.name, bot: !!cfg.bot, x: netD(team, h[0]), y: GY, z: h[1] * ZD, vx: 0, vy: 0, vz: 0, gnd: true,
    act: 'idle', actT: 0, hitDone: false, diveX: 1, diveZ: 0, inReach: 0, chg: 0, chgHold: 0, pw: 1,
    st: { down: 0, stun: 0, hop: 0, sleep: 0, frozen: 0, wrap: 0, puppet: 0, float: 0, sad: 0, flat: 0, giant: 0, half: 0, boost: 0, shrink: 0, tub: 0, rev: 0 }, pupBy: -1, fell: false, bufA: 0, jumpHold: false, bounce: 0, bowled: false, sky: false, prevIn: 0,
    big: 0, mini: 0, fast: 0, soot: 0, gauge: 0, hp: 100, ko: false, hitCd: 0, inp: 0, prev: 0, perfect: false,
    stats: { spk: 0, rcv: 0, blk: 0, fall: 0, pts: 0, sup: 0 }, ai: { serveAt: 0 } };
}

function newGame(cfg) {
  const st = cfg.boss ? { id: 'boss', g: 1 } : STAGES.find(s => s.id === cfg.stage) || STAGES[0]; // v1.31 보스전은 경기장 효과 없이 금고 경기장(전엔 고른 경기장의 중력·바람·군고구마가 섞였음)
  const n = cfg.boss ? 3 : cfg.slots.length >> 1; useCourt(n); /* v1.28 보스전: 우리 팀 3명만 */
  const S = { n, tick: 0, time: 0, phase: 'serve', phaseT: 0, stage: st.id, env: { g: st.g, ceil: st.ceil || 0, sand: st.id === 'beach', windy: !!st.windy, slip: !!st.slip, fest: !!st.fest, wet: !!st.wet, steam: !!st.steam, pigeon: !!st.pigeon, jelly: !!st.jelly, quake: !!st.quake, flux: st.id === 'planet', g0: st.g },
    wind: 0, score: [0, 0], target: cfg.target || 7, diff: cfg.diff || 'normal', ctrl: CTRLS[cfg.ctrl] ? cfg.ctrl : 'normal', itemsOn: cfg.items !== false,
    serveTeam: Math.random() < 0.5 ? 0 : 1, serveIdx: [0, 0], server: 0, pointTeam: -1,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, lastTeam: -1, lastP: -1, touches: 0, noP: -1, power: false, sup: null, supTeam: -1, cap: false, held: true, teamCd: 0, float: 0, home: 0, fuse: 0, serial: 0, chain: 0, nice: 0, quick: false },
    decoys: [], ufo: null, players: [], items: [], peels: [], ice: [0, 0], itemT: rnd(6, 10) * (st.fest ? 0.4 : 1), itemT2: [rnd(20, 35), rnd(20, 35)], itemId: 1,
    freezeT: 0, stopT: 0, slowT: 0, slowN: 0, cut: null, ev: [], evId: 1, teamAI: [{ serial: -1, chaser: -1 }, { serial: -1, chaser: -1 }], winner: -1, rallyHits: 0, pred: null, netLive: null, basin: null, ref: { st: 0, t: 0, team: -1, n: 0 }, mom: null, steams: [], pig: null, pots: [], envT: rnd(8, 12), swap: 0, swapNext: false, swapN: (cfg.target || 7) >= 10 ? Math.round((cfg.target || 7) / 2) : 0 }; // swapN: 이 점수마다 코트 체인지(10점→5, 14점→7, 20점→10)
  for (let i = 0; i < (cfg.boss ? n : n * 2); i++) S.players.push(mkPlayer(i, cfg.slots[i], n));
  if (cfg.boss) { S.target = 20; S.swapN = 0; S.serveTeam = 0; bossInit(S, cfg.boss); }
  if (cfg.chal && CHAL[cfg.chal]) { S.chal = { k: cfg.chal, n: 0, cur: 0, best: 0, sc: 0, tgt: null, side: -1, done: 0 }; S.itemsOn = false; S.target = 99; } // v0.95 혼자 하기 도전 모드
  for (const p of S.players) { p.role = n === 1 ? 'all' : (ROLES[cfg.slots[p.i].role] ? cfg.slots[p.i].role : 'all'); p.dope = cfg.slots[p.i].dope || 0; if (cfg.slots[p.i].doped) S.ev.push([S.evId++, 'txt', Math.round(p.x), Math.round(p.y - 170), Math.round(p.z), '도핑 ' + dopeLabel(p.dope) + (p.dope ? '!' : ''), p.dope > 0 ? 1 : p.dope < 0 ? 2 : 0]); }
  for (const p of S.players) { p.supN = 0; p.supCap = supCapOf(S.target); p.gk = gaugeKOf(S.target); }
  startServe(S);
  return S;
}

function home(S, p) {
  if (S.phase === 'serve' && S.server === p.i) return [netD(p.team, SRV), ZD / 2];
  let k = p.slot; if (S.n >= 2) { const pr = q => ({ setter: 0, spiker: 1, all: 2, libero: 3 })[roleOf(q)]; const m = S.players.filter(q => q.team === p.team).sort((a, c) => pr(a) - pr(c) || a.slot - c.slot); k = m.indexOf(p); } // v0.98 역할 순서로 자리: 세터가 네트 앞, 리베로가 맨 뒤
  const h = HOMES[S.n][k] || HOMES[S.n][p.slot]; return [netD(p.team, h[0]), h[1] * ZD];
}

function swapSides(S) { // 코트 체인지: 두 팀이 좌우를 바꾼다(코드 안의 team 번호는 '왼쪽/오른쪽'이므로 선수·점수·서브 순서를 함께 맞바꾼다)
  S.swap ^= 1; S.score = [S.score[1], S.score[0]]; S.serveTeam = 1 - S.serveTeam; S.serveIdx = [S.serveIdx[1], S.serveIdx[0]]; S.teamAI = [S.teamAI[1], S.teamAI[0]]; S.ice = [S.ice[1], S.ice[0]];
  for (const p of S.players) { p.team = 1 - p.team; p.x = CW - p.x; p.vx = -p.vx; }
  for (const q of S.peels) q.x = CW - q.x; S.items.length = 0;
  if (S.thornF) { S.thornF.team = 1 - S.thornF.team; for (const q of S.thornF.pts) q[0] = CW - q[0]; }
  /* v1.12 팀 번호로 기억하는 것들도 같이 바꾼다(전에는 코트 체인지 뒤 춤추는 네트·다라이·심판 뒤끝·떠블 사용 여부가 상대 팀 것이 됐다) */
  if (S.netLive) { const L = S.netLive; L.team = 1 - L.team; L.dx = -L.dx; L.tx = -L.tx; }
  if (S.basin) S.basin.team = 1 - S.basin.team;
  if (S.ref && S.ref.team >= 0) S.ref.team = 1 - S.ref.team;
  if (S.streak && S.streak.team >= 0) S.streak.team = 1 - S.streak.team;
  if (S.dbl) { S.dbl.used = [S.dbl.used[1], S.dbl.used[0]]; if (S.dbl.on >= 0) S.dbl.on = 1 - S.dbl.on; }
  ev(S, 'swap', NETX, 300, ZD / 2);
}
function startServe(S) {
  S.phase = 'serve'; S.phaseT = 0; S.rallyHits = 0; S.shoe = null; S.dblChk = false; /* v0.95 신발은 점수가 끝나면 다시 신는다 */
  if (S.chal) { S.serveTeam = chalMe(S).team; S.serveIdx[S.serveTeam] = 0; }
  const team = S.serveTeam;
  const mem = S.players.filter(q => q.team === team).sort((a, c) => a.slot - c.slot); S.server = mem[S.serveIdx[team] % mem.length].i;
  for (const p of S.players) {
    for (const k in p.st) p.st[k] = 0; p.act = 'idle'; p.actT = 0; p.chg = 0; p.fell = false; p.bufA = 0; p.jumpHold = false; p.bounce = 0; p.sky = false; p.atSrv = false; p.ai.serveAt = rnd(1.5, 2.3);
    if (p.ko) { p.ko = false; p.hp = Math.max(p.hp, 55); } p.hp = Math.min(100, p.hp + STA.serve);
  }
  if (!S.tick) { const sp = S.players[S.server]; sp.x = netD(team, SRV); sp.z = ZD / 2; sp.atSrv = true; } // 경기 첫 서브
  const b = S.ball;
  b.ultra = false; b.vx = b.vy = b.vz = 0; b.lastTeam = -1; b.lastP = -1; b.noP = -1; b.touches = 0; b.power = false; b.sup = null; b.supTeam = -1; b.cap = false; b.held = true; b.float = 0; b.home = 0; b.fuse = 0; b.teamCd = 0; b.chain = 0; b.nice = 0; b.quick = false; b.serial++;
  S.decoys = []; S.ufo = null; S.mom = null; S.pig = null; S.pots = []; S.steams = []; S.envT = S.env.fest ? rnd(14, 24) : rnd(13, 20); /* v1.31 경기장 효과 덜 자주: 랠리 시작 13~20초 뒤(전 6~10초) */ /* v1.26 야시장 떨이 세일은 랠리 시작 14~24초 뒤(전엔 6~10초라 거의 매 랠리) */ S.ice[0] = S.ice[1] = 0; S.items.length = 0;
  S.wind = S.env.windy ? Math.round(rnd(-1, 1) * 230) : 0;
  if (S.chal) chalServe(S);
  for (const q of S.players) if (q.pupN > 0) q.st.puppet = 30; // 세네 해킹은 서브가 바뀌어도 이어진다
  ev(S, 'ready', NETX, 300, ZD / 2, team);
  const a = S.score[0], c = S.score[1], t = S.target, mp = x => x >= t - 1 && x > Math.min(a, c) && (x + 1 >= t + 5 || x + 1 - Math.min(a, c) >= 2);
  if (!S.boss && (mp(a) || mp(c))) ev(S, 'txt', NETX, 250, ZD / 2, '매치 포인트!', 3);
  if (S.boss) bossServeStart(S);
}

/* ---------- 공 궤적 계산 ---------- */
function cz(z) { return clamp(z, 24, ZD - 24); }
function lob(S, b, tx, tz, ty, apexY) {
  const g = ballG(S, b), hh = heat(S); if (hh > 0) apexY = ty - (ty - apexY) * (1 - 0.45 * hh); // 랠리가 길면 띄운 공도 낮고 빠르게
  apexY = Math.min(apexY, b.y - 30, ty - 30);
  if (S.env.ceil && b.srv) apexY = Math.max(apexY, S.env.ceil + BR + 24); // 서브는 천장에 안 닿게
  else if (S.env.ceil && b === S.ball && Math.random() < 0.22) apexY = S.env.ceil - 70; // v0.51 실내: 가끔 높이 떠서 천장에 '팅' 맞고 떨어진다
  const up = Math.sqrt(2 * g * (b.y - apexY)), T = up / g + Math.sqrt(2 * (ty - apexY) / g);
  b.vy = -up; b.vx = (tx - b.x) / T; b.vz = (cz(tz) - b.z) / T;
}
function lobOver(S, b, team, d, tz, e, apexY) { // 네트를 반드시 넘기는 로브
  const tx = oppD(team, clamp(d + e, 70, 590)), g = ballG(S, b);
  for (let i = 0; i < 30; i++) { // v1.36 네트 바로 앞을 노려도 넘어가게(전 14번)
    lob(S, b, tx, tz, GY - BR, apexY);
    const tn = (NETX - b.x) / (b.vx || 1e-6), yn = b.y + b.vy * tn + 0.5 * g * tn * tn;
    if (tn <= 0 || yn < NETTOP - BR - 16 - (b.srv || b.held ? 60 : 0)) return; // v1.36 서브는 공기 저항까지 생각해 여유를 더 둔다
    apexY -= 45;
  }
}
function drive(S, b, tx, tz, ty, speed) {
  tz = cz(tz);
  const g = ballG(S, b), dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
  let T = Math.hypot(dx, dy, dz) / (speed * BALL_K);
  for (let i = 0; i < 40; i++) {
    const vx = dx / T, vy = (dy - 0.5 * g * T * T) / T;
    let ok = true;
    if ((b.x - NETX) * (tx - NETX) < 0) {
      for (const nx of [NETX - NETW / 2 - 4, NETX + NETW / 2 + 4]) {
        const tn = (nx - b.x) / vx, yn = b.y + vy * tn + 0.5 * g * tn * tn;
        if (yn > NETTOP - BR - 10) ok = false;
      }
    }
    if (ok && S.env.ceil && vy < 0 && b.y - vy * vy / (2 * g) < S.env.ceil + BR + 12) break; // 천장이 있으면 천장에 닿을 만큼 높이 띄우지 않는다(아래 로브로)
    if (ok) { b.vx = vx; b.vy = vy; b.vz = dz / T; return T; }
    T *= 1.1;
  }
  lob(S, b, tx, tz, ty, NETTOP - 120); return 1;
}
function ballStep(S, q, dt, real) {
  if (!q.nog) {
    const g = GB * S.env.g * (q.float > 0 ? 0.5 : 1);
    q.vy += g * dt; q.vx += S.wind * dt * (q.float > 0 ? 1.6 : 1);
  }
  if (q.flt > 0) { q.flt -= dt; q.fph = (q.fph || 0) + dt * 11; q.vz += Math.sin(q.fph) * 260 * dt; q.vx += Math.cos(q.fph * 1.3) * 90 * dt; } // 플로터: 좌우로 흔들림
  q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
  if (!q.out && !S.env.windy) { // 끝선 밖으로 나가는 공은 벽에 튕기지 않는다(강변은 바람에 밀려 나갈 수 있게 벽이 없다)
    if (q.x < BR && q.vx <= 0) { q.x = BR; q.vx = Math.abs(q.vx) * (S.rallyHits === 0 ? 0.25 : S.env.ceil ? 0.92 : 0.75); if (real) ev(S, 'wall', q.x, q.y, q.z); }
    if (q.x > CW - BR && q.vx >= 0) { q.x = CW - BR; q.vx = -Math.abs(q.vx) * (S.rallyHits === 0 ? 0.25 : S.env.ceil ? 0.92 : 0.75); if (real) ev(S, 'wall', q.x, q.y, q.z); }
  }
  if (q.z < 6) { q.z = 6; q.vz = Math.abs(q.vz) * 0.7; if (real) ev(S, 'wall', q.x, q.y, q.z); }
  if (q.z > ZD - 6) { q.z = ZD - 6; q.vz = -Math.abs(q.vz) * 0.7; if (real) ev(S, 'wall', q.x, q.y, q.z); }
  if (S.env.ceil && q.y < S.env.ceil + BR) { q.y = S.env.ceil + BR; q.vy = Math.abs(q.vy) * 0.8; if (real) { ev(S, 'wall', q.x, q.y, q.z); if (q.srv) q.ceilFault = true; } }
  const hw = NETW / 2;
  if (q.y > NETTOP - BR && Math.abs(q.x - NETX) < hw + BR && !(S.netLive && S.netLive.mode)) {
    const cx = clamp(q.x, NETX - hw, NETX + hw), cy = Math.max(q.y, NETTOP);
    let dx = q.x - cx, dy = q.y - cy, d = Math.hypot(dx, dy);
    if (d < BR) {
      if (d < 0.01) { dx = q.vx < 0 ? 1 : -1; dy = 0; d = 1; }
      const nx = dx / d, ny = dy / d;
      q.x = cx + nx * BR; q.y = cy + ny * BR;
      const vn = q.vx * nx + q.vy * ny;
      if (vn < 0) { q.vx -= 1.55 * vn * nx; q.vy -= 1.55 * vn * ny; if (real && Math.abs(vn) > 120) ev(S, 'net', q.x, q.y, q.z); }
      if (real && Math.abs(q.vx) < 25 && ny < -0.8) q.vx += (Math.random() < 0.5 ? -1 : 1) * 60;
    }
  }
}
function predict(S) {
  useCourt(S.n);
  const b = S.ball, out = { pts: [], land: null };
  if (b.held) return out;
  const q = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, float: b.float, out: b.out };
  let t = 0;
  if (b.cap) {
    const u = S.ufo; if (!u || u.st > 1) return out;
    t = u.st === 0 ? (0.55 - u.t) + u.dur : Math.max(0, u.dur - u.t);
    q.x = u.st === 1 ? u.x : oppD(u.team, 330); q.z = u.st === 1 ? u.z : ZD / 2; q.y = 237; q.vx = q.vz = 0; q.vy = 1300;
  }
  for (let i = 0; i < 360; i++) {
    ballStep(S, q, DT, false); t += DT;
    out.pts.push({ x: q.x, y: q.y, z: q.z, vy: q.vy, t });
    if (q.y + BR >= GY) { out.land = { x: q.x, z: q.z, t }; break; }
  }
  return out;
}

/* ---------- 체력·게이지·득점 ---------- */
const GAUGE_K = 0.45; // 필살기 게이지가 차는 속도(전체 배율)
function supCapOf(t) { return t <= 7 ? 99 : t <= 10 ? 1 : t <= 14 ? 2 : t <= 20 ? 3 : 99; } // v0.48 경기당 필살기 횟수(10점 1·14점 2·20점 3, 연습·미리보기는 무제한)
function gaugeKOf(t) { return t <= 7 ? 1 : t <= 10 ? 1.45 : t <= 14 ? 1.35 : t <= 20 ? 1.3 : 1; } // 목표 점수별 게이지 차는 속도
function supLocked(p) { return p.supBan > 0 || (p.supN | 0) >= (p.supCap || 99); }
function addGauge(p, v) { p.gauge = supLocked(p) ? 0 : clamp(p.gauge + v * GAUGE_K * (p.gk || 1), 0, 100); }
function hurt(S, p, d) {
  if (p.ko) return;
  p.hp -= d * (1 + (3 - chOf(p).gut) * 0.14);
  if (p.hp <= 0) {
    p.hp = 0; p.ko = true; p.st.down = Math.max(p.st.down, 3.3 * cool(p)); p.act = 'idle'; p.chg = 0; p.stats.fall++;
    p.vy = -1950 * Math.sqrt(S.env.g); p.gnd = false; p.vx = clamp(p.vx * 0.4, -150, 150); p.sky = true; p.bounce = 1;
    ev(S, 'ko', p.x, p.y - 60, p.z, p.i); ev(S, 'txt', p.x, p.y - 170, p.z, '기절!!', 3);
  }
}
function noTouch(V, p) { // 파티(2:2·3:3): 방금 공을 친 사람은 연달아 못 친다(토스→스파이크, 토스→토스 혼자 하기 금지). 동료가 전부 기절·얼음·잠·김밥 상태일 때만 봐준다
  const b = V.ball; if (V.mom && V.mom.st === 0 && p.team !== V.mom.team && b.lastTeam === V.mom.team) return true; // 엄마 돼지에게 가는 공은 못 건드린다
  if (V.n < 2 || b.noP !== p.i || b.lastTeam !== p.team) return false;
  for (const q of V.players) if (q.i !== p.i && q.team === p.team && !(q.ko || q.st.frozen > 0 || q.st.sleep > 0 || q.st.wrap > 0)) return true;
  return false;
}
function touch(S, p, kind) {
  const b = S.ball;
  if (kind === 'block' || b.lastTeam !== p.team) { b.chain = 0; b.nice = 0; b.cpl = []; }
  if (kind === 'bump') { b.chain++; (b.cpl = b.cpl || []).push(p.i); } else { b.chain = 0; b.nice = 0; b.cpl = []; }
  b.flt = 0; b.lastKind = kind; // v1.12 마지막으로 친 방식(다라이는 공격만 막는다)
  b.quick = false;
  if (kind === 'block') { b.lastTeam = p.team; b.touches = 0; }
  else if (b.lastTeam === p.team) b.touches++; else { b.lastTeam = p.team; b.touches = 1; }
  b.full = false; b.out = false; b.ultra = false; b.srv = false; b.setBy = -1; b.lastP = p.i; b.noP = kind === 'bump' || kind === 'spike' ? p.i : -1; b.serial++; b.teamCd = 0.2; p.hitCd = 0.3; p.hitDone = true; S.rallyHits++; // 블로킹·몸에 맞은 공은 같은 사람이 이어서 쳐도 된다
  if (b.touches > 3) { ev(S, 'txt', b.x, b.y - 40, b.z, '포 히트! (4번 터치)', 2); point(S, 1 - p.team, -1); return false; }
  return true;
}
function point(S, team, scorer) {
  if (S.phase !== 'rally') return;
  if (S.chal) return chalPoint(S, team, scorer);
  if (S.boss) return bossPoint(S, team, scorer);
  S.guestN = (S.guestN || 0) + 1; if (!S.guest && !S.tut && S.guestN >= 4 && Math.random() < 0.13) { S.guestN = 0; const k = Math.random() < 0.55 ? 0 : 1, dir = Math.random() < 0.5 ? 1 : -1; S.guest = { k, dir, st: 0, t: 0, x: dir > 0 ? -220 : CW + 220, z: ZD - 24 }; ev(S, 'txt', dir > 0 ? 160 : CW - 160, GY - 120, ZD - 24, k ? '(고양이다)' : '멍멍!', 0); } // v0.95 깜짝 손님(점수 사이에만)
  { const R = S.ref; if (R) { if (R.n > 0) R.n--; if (R.st !== 2) { R.st = 1; R.t = 0; } } } // v0.95 심판: 점수마다 휘슬, 뒤끝 남은 횟수 줄이기
  { const sk = S.streak || (S.streak = { team: -1, n: 0 }); if (sk.team === team) sk.n++; else { sk.team = team; sk.n = 1; } // v0.55 기세: 3연속 득점마다 게이지 조금
    if (sk.n >= 3 && sk.n % 3 === 0) { for (const q of S.players) if (q.team === team) addGauge(q, 8); ev(S, 'txt', netD(team, 320), 230, ZD / 2, '기세!', 1, 1); } }
  if (S.thornF && --S.thornF.n <= 0) S.thornF = null; for (const q of S.players) { if (q.tis > 0) q.tis--; if (q.supBan > 0) q.supBan--; if (q.pupN > 0 && --q.pupN <= 0) q.st.puppet = 0; }
  const dv = S.dbl && S.dbl.on >= 0 ? 2 : 1; if (dv === 2) { ev(S, 'txt', NETX, 250, ZD / 2, team === S.dbl.on ? '떠블 성공! +2' : '떠블 실패… 상대 +2', team === S.dbl.on ? 1 : 3, 1); S.dbl.on = -1; } // v0.95 묻고 떠블로 가
  S.slowCmb = false; S.slowT = 0; S.score[team] += dv; S.phase = 'point'; S.phaseT = 0; S.pointTeam = team;
  for (const T of [0, 1]) { const d = S.score[1 - T] - S.score[T], k = d >= 9 ? 0.15 : d >= 7 ? 0.12 : d >= 5 ? 0.08 : 0; for (const q of S.players) if (q.team === T) { if (k > 0 && !(q.ck > 1)) ev(S, 'txt', q.x, q.y - 170, q.z, '추격!', 1); q.ck = 1 + k; } } // v0.55 추격: 5점 차 이상 지는 팀 능력 +8~15%
  if (scorer >= 0) { S.players[scorer].stats.pts++; addGauge(S.players[scorer], 22); } // v0.49 내 공격으로 점수를 내면 크게
  for (const p of S.players) { addGauge(p, p.team === team ? (chOf(p).id === 'midwae' ? 22 : 10) : 14); if (p.team === team && p.gnd && !busy(p)) { p.vy = -rnd(330, 470); p.gnd = false; p.act = 'idle'; p.chg = 0; } }
  if (S.serveTeam !== team) { S.serveTeam = team; S.serveIdx[team]++; }
  const t = S.target, a = S.score[0], c = S.score[1], cap = t + 5;
  if ((Math.max(a, c) >= t && Math.abs(a - c) >= 2) || Math.max(a, c) >= cap) S.winner = a > c ? 0 : 1;
  ev(S, 'point', S.ball.x, GY, S.ball.z, team, S.winner >= 0 ? 1 : 0);
  if (S.winner < 0 && S.swapN > 0 && !S.swapDone && Math.max(S.score[0], S.score[1]) >= S.swapN) { S.swapNext = true; S.swapDone = true; } // v0.55 코트 변경은 경기당 한 번: 한 팀이 목표의 절반(10점→5, 14점→7, 20점→10)에 먼저 닿았을 때
  if (S.winner >= 0) S.slowT = 1.0; // 마지막 한 점은 느리게
}
function knock(S, p, dur, dir) {
  const c = chOf(p);
  p.st.down = Math.max(p.st.down, dur * gutMul(p) * (c.id === 'bbabjji' ? 0.45 : 1));
  p.vx = dir * rnd(300, 400); p.vz = rnd(-90, 90); p.vy = -rnd(450, 540); p.gnd = false; p.act = 'idle'; p.chg = 0; p.stats.fall++; addGauge(p, 10); p.bounce = 1; p.bowled = false; p.st.flat = 0;
}
function popBall(S, p, spread, lo, hi) {
  const b = S.ball;
  let tx = p.x + rnd(-spread, spread);
  tx = p.team === 0 ? clamp(tx, 60, NETX - 60) : clamp(tx, NETX + 60, CW - 60);
  lob(S, b, tx, p.z + rnd(-spread, spread) * 0.6, GY - 200, GY - rnd(lo, hi)); b.power = false; b.home = 0;
}
/* 필살기 공을 받았을 때. true면 여기서 처리 끝 */
function bogoTrick(S, p) { // v0.51 바코드: 진짜 공을 받아도 50% 확률로 휴지와 바꿔치기(공 하나에 한 번)
  const b = S.ball; if (b.sup !== 'bogo' || b.trick || !S.decoys.length || Math.random() >= 0.5) return false;
  const d = S.decoys.find(q => !q.dead); if (!d) return false;
  b.trick = true; for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) { const t2 = b[k]; b[k] = d[k]; d[k] = t2; } d.dead = true; // 받은 건 휴지였다
  p.st.stun = 1.6 * gutMul(p); p.tis = 2; p.hitCd = 0.4; hurt(S, p, 6); ev(S, 'poof', p.x, p.y - 60, p.z, '행사 종료', 0); ev(S, 'txt', p.x, p.y - 150, p.z, '바꿔치기! 휴지였다…', 2);
  return true;
}
function supReceive(S, p, perfect) {
  const b = S.ball, k = b.sup;
  if (!k) return false;
  if (k === 'hot') { ev(S, 'txt', p.x, p.y - 150, p.z, '앗 뜨거!', 3); hurt(S, p, 3); return false; }
  if (b.supTeam === p.team) return false;
  if (k === 'bogo') { if (bogoTrick(S, p)) return true; b.sup = null; return false; }
  if (k === 'thorn' && perfect && !((p.pfK || 0) <= 0.5)) perfect = false; // v0.45 가시공은 나이스 타이밍이 더 좁다
  if (perfect) {
    if (k === 'ufo') { const ow = S.players[b.supP]; if (ow) { ow.supBan = 3; ow.gauge = 0; ev(S, 'txt', ow.x, ow.y - 170, ow.z, '우주선 고장… 3점 동안 필살기 봉인', 2); } if (S.ufo) { ev(S, 'boom', S.ufo.x, S.ufo.y, S.ufo.z); S.ufo = null; } ev(S, 'txt', NETX, 230, ZD / 2, '우주선 폭파!!', 1, 1); } // v0.47 빱찌 우주선을 나이스로 받으면 폭파, 양 팀 합쳐 3점이 날 때까지 게이지가 안 찬다
    b.sup = null; b.home = 0; addGauge(p, 15); // v0.55 카운터: 필살기 공을 나이스로 받으면 바로 상대 코트로 빠르게 되돌린다
    if (!touch(S, p, 'bump')) return true;
    b.power = true; drive(S, b, oppD(p.team, rnd(330, 540)), rnd(60, ZD - 60), GY - BR, 1300); p.act = 'bump'; p.hitDone = true;
    ev(S, 'hit', b.x, b.y, b.z, 3, p.i); ev(S, 'txt', p.x, p.y - 160, p.z, '카운터!!', 1, 1); S.stopT = 0.08; p.stats.rcv++;
    return true;
  }
  const dir = b.vx >= 0 ? 1 : -1;
  if (!touch(S, p, 'body')) return true;
  const gm = gutMul(p); S.stopT = 0.14; ev(S, 'hit', b.x, b.y, b.z, 3, p.i);
  if (k === 'ufo') { knock(S, p, 1.6, dir); p.vy = -200; hurt(S, p, 32); ev(S, 'bonk', p.x, p.y - 60, p.z, '납작…', 3); popBall(S, p, 130, 380, 480); }
  else if (k === 'thorn') { p.st.hop = 1.8 * gm; hurt(S, p, 26); p.gauge = Math.max(0, p.gauge - 25); ev(S, 'bonk', p.x, p.y - 60, p.z, '앗 따가! 엉덩이!', 3); popBall(S, p, 170, 300, 430); }
  else if (k === 'paw') { knock(S, p, 1.3, dir); hurt(S, p, 20); ev(S, 'bonk', p.x, p.y - 60, p.z, '앞발에 꾹!', 3); popBall(S, p, 160, 300, 430); }
  else if (k === 'slap') { knock(S, p, 1.0, dir); hurt(S, p, 12); ev(S, 'bonk', p.x, p.y - 60, p.z, '네트한테 맞았다!', 3); popBall(S, p, 160, 300, 430); }
  else if (k === 'mom') { knock(S, p, 1.4, dir); hurt(S, p, 22); ev(S, 'bonk', p.x, p.y - 60, p.z, '엄마 무서워!', 3); popBall(S, p, 150, 320, 440); }
  else if (k === 'ice') { p.st.frozen = 2.0 * gm; p.act = 'idle'; p.vx = dir * 330; hurt(S, p, 18); ev(S, 'freeze', p.x, p.y - 60, p.z, '꽁꽁!', 3); popBall(S, p, 110, 340, 420); }
  b.sup = null;
  return true;
}

function dirKeys(p, inp) { // fwd = 상대 코트 쪽, back = 우리 코트 뒤쪽, far = 화면 안쪽(↑), near = 화면 바깥쪽(↓)
  const f = fdir(p);
  return { fwd: !!(inp & (f > 0 ? K.R : K.L)), back: !!(inp & (f > 0 ? K.L : K.R)), far: !!(inp & K.U), near: !!(inp & K.D) };
}
function aimKeys(p, inp) { return p.aimOn && !p.bot ? { fwd: p.aimX > 0, back: p.aimX < 0, far: p.aimZ < 0, near: p.aimZ > 0 } : dirKeys(p, inp); } // 사람은 조준 칸, PC는 누르고 있는 방향키
function laneZ(p, d, straight) { return d.far ? ZD * 0.18 : d.near ? ZD * 0.82 : straight; }

function hitBump(S, p, viaDive) {
  const b = S.ball, c = chOf(p);
  const perfect = p.perfect && !viaDive;
  if (supReceive(S, p, perfect)) return;
  const d = dirKeys(p, viaDive ? 0 : p.inp);
  const vin = Math.hypot(b.vx, b.vy, b.vz) * (b.power ? 1 : 0.55);
  const wasOpp = b.lastTeam !== p.team, air = !p.gnd && !viaDive, srvK = S.rallyHits === 0 && wasOpp ? (b.ultra ? 0.95 : 1.15) : 1; // v0.51 서브 리시브는 쉽게, 초강서브는 어렵게
  if (!touch(S, p, 'bump')) return;
  if (perfect) b.nice++;
  if (!wasOpp && roleOf(p) === 'setter') b.setBy = p.i; // v0.98 세터 토스: 동료 스파이크 힘↑
  const rl = roleOf(p); if (perfect && ((rl === 'libero' && wasOpp) || (rl === 'setter' && !wasOpp))) addGauge(p, 10); // v0.95 역할 퍼펙트 보너스(v0.98 +10)
  const n = b.touches, skill = (820 + (tq(c) - 3) * 170) * fat(p) * srvK * (p.ck || 1) * (wasOpp ? roleK(p, 'rcv') : roleK(p, 'toss'));
  let err = c.id === 'barcode' ? 0 : (6 - tq(c)) * 10, stag = false;
  if (perfect) err = 0;
  if (c.id === 'banban' && !p.bw) err *= 0.6;
  else if (viaDive) err = 95;
  else if (vin > skill * 1.22) { err = 300; stag = true; }
  else if (vin > skill * 0.92) err = 95;
  const tr = !wasOpp && b.chain >= 2 && n < 3 ? 0.5 : 1; // 리시브된 공을 토스하면 더 정확하게 올린다
  const e = rnd(-err, err) * tr, ez = rnd(-err, err) * 0.5 * tr, T = p.team; p.toss = !wasOpp && !air; // 우리 편 공을 받아 올리면 토스 동작
  if (air) { // 공중 A = 페인트(살짝 넘기기)
    lobOver(S, b, T, d.fwd ? 330 : 115, laneZ(p, d, p.z) + ez, e * 0.5, Math.min(b.y - 36, NETTOP - 64));
    ev(S, 'txt', p.x, p.y - 150, p.z, '페인트~', 0);
  } else if (n >= 3) {
    if (d.fwd) lobOver(S, b, T, 540, laneZ(p, d, p.z) + ez, e, GY - 400);
    else if (d.back) lobOver(S, b, T, 150, laneZ(p, d, p.z) + ez, e, NETTOP - 100);
    else lobOver(S, b, T, 390, laneZ(p, d, p.z) + ez, e, GY - 390);
  } else {
    const tz = laneZ(p, d, (p.z + ZD / 2) / 2) + ez;
    if (d.fwd) { lob(S, b, netD(T, 80) + e, tz, GY - 240, GY - 350); b.quick = true; }
    else if (d.back) lob(S, b, netD(T, 400) + e, tz, GY - 240, GY - 440);
    else lob(S, b, netD(T, 165) + e, tz, GY - 240, GY - (stag ? rnd(250, 360) : 450));
  }
  if (!b.sup && !S.tut) { // v0.41: 받아 넘기는 공도 실수하면 코트 밖으로(나이스 타이밍이면 안전)
    const over = air || n >= 3, po = perfect ? 0 : over ? (err >= 95 ? OUT.overHard : (6 - tq(c)) * OUT.over) : wasOpp ? (viaDive ? OUT.dive : stag ? OUT.stag : err >= 95 ? OUT.hard : OUT.recv) : (6 - tq(c)) * OUT.toss + (viaDive ? 0.05 : 0);
    if (Math.random() < po) { b.out = true; b.outK = over ? 'over' : wasOpp ? 'recv' : 'toss'; b.quick = false; if (over) lob(S, b, oppD(T, 640 + rnd(25, 60)), cz(b.z + rnd(-60, 60)), GY - BR, GY - 420); else lob(S, b, netD(T, 640 + rnd(25, 70)), cz(b.z + rnd(-80, 80)), GY - BR, GY - rnd(300, 430)); }
  }
  b.power = false; b.home = 0;
  if (wasOpp) p.stats.rcv++; tire(p, perfect ? 0.6 : 1.2);
  addGauge(p, perfect ? 24 : 5); // v0.49 나이스 리시브·토스는 크게
  if (stag) { p.st.stun = 0.8 * gutMul(p); hurt(S, p, 10); ev(S, 'bump', b.x, b.y, b.z, 2); ev(S, 'txt', p.x, p.y - 150, p.z, '어질어질…', 2); }
  else if (viaDive) { ev(S, 'bump', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 110, p.z, viaDive === 'body' ? '몸으로 받기!' : '몸 날려 받기!', 0); }
  else if (perfect) { S.stopT = 0.03; ev(S, 'hit', b.x, b.y, b.z, 1, p.i); ev(S, 'bump', b.x, b.y, b.z, 3); ev(S, 'txt', p.x, p.y - 150, p.z, wasOpp ? '나이스 리시브!' : '나이스 토스!', 1); }
  else ev(S, 'bump', b.x, b.y, b.z, 0);
}
function spikeAim(p, inp) { // 방향키로 고른 스파이크 목표(오차 없이). 화면의 조준 표시에도 쓴다
  const d = aimKeys(p, inp), dist = d.fwd ? 525 : d.back ? 185 : 350;
  return { x: clamp(oppD(p.team, dist), 50, CW - 50), z: cz(laneZ(p, d, p.z)) };
}
function shotPreview(S, p, inp) { // 내 서브·스파이크가 날아갈 길(오차·바람 제외 없이 실제 계산과 같은 방식). 화면에 흐린 점선으로 보여 준다
  const c = chOf(p), f = fdir(p), d = aimKeys(p, inp), T = p.team, b0 = S.ball, q = { x: b0.x, y: b0.y, z: b0.z, vx: 0, vy: 0, vz: 0, float: 0, out: false };
  if (S.phase === 'serve' && S.server === p.i) {
    const free = !p.bot && p.aimOn && p.aimSx != null, tx = oppD(T, free ? p.aimSx : d.fwd ? 520 : d.back ? 190 : 350), tz = free ? p.aimSz : laneZ(p, d, p.z); q.z = p.z; q.srv = true;
    if (p.act === 'charge') { q.x = p.x + f * 22; q.y = p.y - 215; drive(S, q, tx, tz, GY - BR, powV(c) * fat(p) * (0.58 + 0.36 * p.chg)); }
    else { q.x = p.x + f * 26; q.y = p.y - 78; lobOver(S, q, T, free ? p.aimSx : d.fwd ? 520 : d.back ? 190 : 350, tz, 0, GY - 480); }
  } else { // 스파이크: 공이 내 손에 가장 가까워질 곳에서 때린다고 보고, 거기서 조준한 곳까지
    const r = { x: b0.x, y: b0.y, z: b0.z, vx: b0.vx, vy: b0.vy, vz: b0.vz, float: b0.float || 0, out: false }, hx = p.x + f * 16, hy = p.y - 100; let best = 1e9;
    for (let i = 0; i < 60; i++) { const dd = Math.hypot(r.x - hx, r.y - hy); if (dd < best) { best = dd; q.x = r.x; q.y = r.y; q.z = r.z; } ballStep(S, r, DT, false); if (r.y + BR >= GY) break; }
    const a = spikeAim(p, inp); drive(S, q, a.x, a.z, GY - BR, powV(c) * fat(p) * (0.76 + 0.52 * (p.chg || 0)) * (p.big > 0 ? 1.1 : 1) * (p.mini > 0 ? 0.85 : 1) * (1 + heat(S))); }
  const pts = []; for (let i = 0; i < 300; i++) { ballStep(S, q, DT, false); if (i % 3 === 0) pts.push([q.x, q.y, q.z]); if (q.y + BR >= GY) { pts.push([q.x, GY - BR, q.z]); break; } }
  return pts;
}
function spikeTarget(S, p, d, acc) { // acc: 오차 배율(연결 공격이면 작아진다)
  acc = acc || 1; const T = p.team, c = chOf(p), e = rnd(-1, 1) * (16 + (6 - tq(c)) * 16) * acc, ez = rnd(-1, 1) * (10 + (6 - tq(c)) * 11) * acc;
  const dist = d.fwd ? 525 : d.back ? 185 : 350;
  return { x: clamp(oppD(T, dist) + e, 50, CW - 50), z: cz(laneZ(p, d, p.z) + ez) };
}
function hitSpike(S, p) {
  const b = S.ball, c = chOf(p);
  if (supReceive(S, p, false)) return;
  const d = aimKeys(p, p.inp);
  const mineB = b.lastTeam === p.team, chain = mineB ? b.chain : 0, nice = mineB ? b.nice : 0, quick = mineB && b.quick, air = !p.gnd, cpl = mineB ? (b.cpl || []).slice(-2) : [];
  const direct = !mineB && b.lastTeam >= 0, back = air && Math.abs(p.x - NETX) > 290 * XS;
  const setB = mineB && b.setBy >= 0 && b.setBy === b.lastP && b.setBy !== p.i ? b.setBy : -1; // v0.98 세터가 올려 준 공
  if (!touch(S, p, 'spike')) return;
  const chance = S.slowCmb && S.slowP === p.i; // v0.43: 찬스에서 친 공은 1.5배 빠르게
  if (S.slowCmb) { S.slowCmb = false; S.slowT = 0; } // 치는 순간 슬로모션 끝
  let tag = null, mul = 1, bonus = 0, acc = 1;
  if (air && chain >= 2 && nice >= 1 && p.pw >= 1.12) { tag = '3단 콤보!'; mul = 1.2; bonus = 12; acc = 0.4; } // 리시브→토스→스파이크에 나이스가 끼고 힘을 모아 치면
  else if (air && chain >= 2) { tag = '연결 공격!'; mul = 1.1; bonus = 7; acc = 0.6; } // v0.38: 리시브→토스→스파이크로 이어지면 가산점
  else if (air && quick) { tag = '속공!'; mul = 1.1; bonus = 6; }
  else if (air && direct) { tag = '다이렉트!'; mul = 1.04; bonus = 6; }
  else if (back) { tag = '백어택!'; mul = 1.05; bonus = 7; }
  const tg = spikeTarget(S, p, d, acc), full = p.pw >= 1.26; b.full = !p.gnd && full;
  const duo = air && !S.tut && S.players.find(q => q !== p && q.team === p.team && !q.gnd && !q.ko && q.jumpAt != null && p.jumpAt != null && Math.abs(q.jumpAt - p.jumpAt) <= 0.3 && Math.hypot(q.x - p.x, q.z - p.z) < 260 * XS); // v0.95 합동 스파이크: 같은 팀 둘이 0.3초 안에 같이 뛰면 힘↑(게이지와 무관)
  if (duo) { mul *= 1.15; ev(S, 'duo', p.x, p.y, p.z, p.i, duo.i); ev(S, 'txt', (p.x + duo.x) / 2, p.y - 250, (p.z + duo.z) / 2, '합동 스파이크!!', 1, 1); }
  const sp = powV(c) * fat(p) * roleK(p, 'spk') * (setB >= 0 ? roleK(S.players[setB], 'setb') : 1) * p.pw * (p.gnd ? 0.62 : 1) * (p.big > 0 ? 1.1 : 1) * (p.mini > 0 ? 0.85 : 1) * (1 + heat(S)) * mul * (p.st.giant > 0 ? 1.85 : 1) /* v1.15 1.4→1.6, v1.31 →1.85 */ * (p.st.half > 0 ? 0.45 : 1) * (c.id === 'banban' && p.bw ? 1.1 : 1) * (chance ? 1.5 : 1) * (p.ck || 1);
  b.home = 0;
  drive(S, b, tg.x, tg.z, GY - BR, sp); b.power = !p.gnd && p.pw > (p.bot ? 0.9 : SPK_POW); // 강스파이크 어렵게는 사람만(PC 공격은 그대로)
  if (!b.sup && !(p.st.giant > 0) && !S.tut) { // v0.41 스파이크 아웃: 힘·기술·조준 칸(끝·옆줄)·타이밍(손에서 먼 곳)·랠리 과열로 늘고, 연결 공격이면 줄어든다
    const s2 = psc(p), off = clamp(d3(b.x, b.y, b.z, p.x + fdir(p) * 16 * s2, p.y - 80 * s2, p.z) / (100 * s2 * ctl(S, p).reach), 0, 1);
    const po = (OUT.spk + (6 - tq(c)) * OUT.tec + (p.pw >= 1.26 ? OUT.full : p.pw > 1.1 ? OUT.strong : 0) + (d.fwd ? OUT.deep : 0) + (d.far || d.near ? OUT.side : 0) + off * off * OUT.late + heat(S) * OUT.heat) * (p.gnd ? 0.5 : 1) * acc * roleK(p, 'out');
    if (Math.random() < po) { b.out = true; b.outK = 'spike'; drive(S, b, oppD(p.team, 640 + rnd(25, 70)), tg.z, GY - BR, sp); }
  }
  if (p.st.giant > 0 && !p.gnd) { b.sup = 'paw'; b.supTeam = p.team; b.power = true; ev(S, 'txt', p.x, p.y - 260, p.z, '앞발 스파이크!!', 3, 1); }
  ev(S, 'spike', b.x, b.y, b.z, full ? 1 : 0, p.i);
  if (full) { ev(S, 'txt', p.x, p.y - 170, p.z, '풀파워!!', 1); hurt(S, p, 4); }
  if (air && !S.tut && !S.shoe && Math.random() < (S.shoeP != null ? S.shoeP : full ? 0.25 : 0.035)) { const fw = p.team === 0 ? 1 : -1; S.shoe = { x: p.x, y: p.y - 10, z: p.z, vx: fw * 0.6 * Math.abs(b.vx) + fw * 200, vy: -380, vz: (b.vz || 0) * 0.5, rot: 0, by: p.i, gnd: 0, hit: -1 }; ev(S, 'txt', p.x, p.y - 210, p.z, '앗, 내 신발!', 3); } // v0.95 신발 날아감
  if (tag) { ev(S, 'txt', p.x, p.y - (full ? 232 : 180), p.z, tag, 1, 1); addGauge(p, bonus); }
  if (chain >= 2 && cpl.length === 2 && cpl[0] !== cpl[1] && cpl[1] !== p.i) { for (const q of S.players) if (q.team === p.team) addGauge(q, 6); ev(S, 'txt', p.x, p.y - 290, p.z, '팀플레이!', 1); } // v0.55 리시브·토스·스파이크를 다른 사람이 이어 가면 팀 게이지
  S.stopT = air ? (full ? 0.08 : tag ? 0.06 : 0.05) : 0.03; /* v0.55 히트스톱: 약 0.03 / 강 0.05 / 풀파워 0.08 */
  ev(S, 'hit', b.x, b.y, b.z, full ? 3 : tag ? 2 : air ? 1 : 0, p.i);
  p.stats.spk++; addGauge(p, full ? 14 : 9); tire(p, full ? 4.5 : 2.5);
}
function hitBlock(S, p) {
  const b = S.ball, c = chOf(p), f = fdir(p);
  if (b.sup === 'bogo' && b.supTeam !== p.team && bogoTrick(S, p)) return;
  if (b.sup && b.sup !== 'hot' && b.supTeam !== p.team && b.sup !== 'bogo') { supReceive(S, p, false); return; }
  const hitter = S.players[b.lastP], hp = hitter ? chOf(hitter).pow : 3;
  const wasPower = b.power, wasFull = b.full, cw = S.boss && S.boss.cwSer === b.serial && b.lastTeam === 1;
  if (!touch(S, p, 'block')) return;
  if (cw) { bossParry(S, p); p.stats.blk++; addGauge(p, 20); return; }
  const boss = c.id === 'goseum';
  if (wasPower && !boss && ((hp - c.pow >= 2 && Math.random() < 0.56) || (wasFull && Math.random() < 0.46))) { // 파워 차이가 크거나 풀파워면 손을 뚫는다
    b.vx *= 0.45; b.vy = -420; b.power = false; ev(S, 'block', b.x, b.y, b.z, 0); ev(S, 'txt', p.x, p.y - 190, p.z, '블록 아웃!', 2);
  } else {
    b.vx = f * (Math.abs(b.vx) * (boss ? 0.85 : 0.5) + (boss ? 240 : 190)); b.vy = wasPower ? (boss ? 420 : 240) : -160; b.vz *= 0.4; b.power = false;
    ev(S, 'block', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 190, p.z, boss ? '가시 장벽!' : '블로킹!', 1);
  }
  p.stats.blk++; addGauge(p, 14); tire(p, 2); S.stopT = 0.09; ev(S, 'hit', b.x, b.y, b.z, 2, p.i);
}
function hitBody(S, p) {
  const b = S.ball, c = chOf(p), s = p.st;
  if (s.sleep > 0) { s.sleep = 0; ev(S, 'txt', p.x, p.y - 150, p.z, '헉! 깼다', 0); }
  if (supReceive(S, p, false)) return;
  const v = Math.hypot(b.vx, b.vy, b.vz), strong = b.power && v > 465 + c.gut * 115;
  const dir = b.vx >= 0 ? 1 : -1, T = p.team;
  if (!touch(S, p, 'body')) return;
  p.hitCd = 0.36; b.home = 0;
  if (s.down > 0 && c.id === 'bbabjji' && !p.ko && Math.random() < 0.5) { /* v0.50 바둥바둥 리시브는 절반 확률 */ lob(S, b, netD(T, 200) + rnd(-50, 50), p.z + rnd(-40, 40), GY - 240, GY - 430); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 90, p.z, '바둥바둥 리시브!', 1); return; }
  if (strong && c.id === 'bami' && s.down <= 0) { lob(S, b, netD(T, 170) + rnd(-25, 25), (p.z + ZD / 2) / 2, GY - 240, GY - 450); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 3); ev(S, 'txt', p.x, p.y - 150, p.z, '밤송이 헤딩!', 1); p.stats.rcv++; return; }
  if (strong && c.id === 'darai' && s.down <= 0) { s.stun = Math.max(s.stun, 0.45); lob(S, b, netD(T, 190) + rnd(-60, 60), p.z + rnd(-50, 50), GY - 240, GY - 420); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 2); ev(S, 'txt', p.x, p.y - 150, p.z, '텅!', 2); S.stopT = 0.08; return; }
  if (strong && p.bot && s.down <= 0 && s.frozen <= 0 && v <= 1150 && Math.random() < aiDf(S).dig * (S.boss ? 1 : 0.65)) { /* v1.36 PC 디그 0.65배 */ lob(S, b, netD(T, 190) + rnd(-60, 60), p.z + rnd(-50, 50), GY - 230, GY - 420); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 2); ev(S, 'txt', p.x, p.y - 150, p.z, '디그!', 1); p.stats.rcv++; return; } // v1.16 PC 강타 받아 내기(보통 25%·어려움 45%·지옥 60%)
  if (strong && s.down <= 0 && s.frozen <= 0 && v <= 1150 && roleOf(p) === 'libero' && Math.random() < roleK(p, 'tough')) { lob(S, b, netD(T, 190) + rnd(-50, 50), p.z + rnd(-40, 40), GY - 240, GY - 440); b.power = false; ev(S, 'bump', b.x, b.y, b.z, 2); ev(S, 'txt', p.x, p.y - 150, p.z, '리베로 디그!', 1); p.stats.rcv++; addGauge(p, 6); return; } // v0.98 리베로: 강타를 절반 확률로 버텨 낸다
  if (strong && s.down <= 0 && s.frozen <= 0) {
    S.stopT = 0.13; ev(S, 'hit', b.x, b.y, b.z, 3, p.i);
    if (v > 1150 && s.float <= 0) { // 풀파워에 정통으로 맞으면 하늘로 날아간다
      knock(S, p, 2.3, dir); p.vx *= 0.4; p.vy = -1950 * Math.sqrt(S.env.g); p.sky = true; hurt(S, p, 28); popBall(S, p, 280, 150, 330);
      ev(S, 'bonk', p.x, p.y - 60, p.z, '저 멀리~', 3); ev(S, 'mark', p.x, p.y, p.z, p.i); ev(S, 'fly', p.x, p.y - 60, p.z, p.i); S.stopT = 0.17; S.slowT = 0.4; return;
    }
    if (p.gnd && b.vy > 560 && b.y < p.y - 70 * psc(p) && Math.random() < 0.5) { // 위에서 내리꽂힌 공: 납작해진다
      s.flat = 1.25 * gutMul(p); s.stun = Math.max(s.stun, s.flat); p.act = 'idle'; p.chg = 0; p.vx = p.vz = 0; p.stats.fall++; addGauge(p, 10); hurt(S, p, 22); popBall(S, p, 240, 170, 330);
      ev(S, 'bonk', p.x, p.y - 40, p.z, '납작…', 3); return;
    }
    knock(S, p, 1.3, dir); hurt(S, p, 24); popBall(S, p, 280, 150, 330);
    ev(S, 'mark', p.x, p.y, p.z, p.i); ev(S, 'bonk', p.x, p.y - 60, p.z, ['퍽!', '안면 리시브!', '으악!', '철푸덕', '뿌엥!', '눈앞에 별이…'][Math.floor(Math.random() * 6)], 3); return;
  }
  if (s.down > 0 && p.gnd && Math.random() < 0.7) ev(S, 'txt', p.x, p.y - 80, p.z, ['꾸엑!', '아야!', '밟지 마!', '나 여기 있어…'][Math.floor(Math.random() * 4)], 0);
  b.vy = -rnd(400, 540); b.vx = clamp((b.x - p.x) * 5, -230, 230) + rnd(-40, 40); b.vz = clamp((b.z - p.z) * 4, -160, 160) + rnd(-30, 30); b.power = false;
  ev(S, 'boing', b.x, b.y, b.z);
}

/* ---------- 필살기 ---------- */
function clashScan(S) { // 상대 컷인이 뜬 동안 D를 누르면(PC는 이기는 상성일 때 난이도 확률로) 필살기 대결
  const cut = S.cut; if (cut.vs != null || cut.t > 0.8 || S.phase !== 'rally') return;
  const A = S.players[cut.p]; if (!A) return;
  for (const q of S.players) {
    if (q.team === A.team || q.gauge < 100 || supLocked(q) || q.ko) continue;
    let go = false;
    if (q.bot) { if (!cut.botChk) go = BEATS[chOf(q).cat] === chOf(A).cat && Math.random() < aiDf(S).counter; }
    else go = !!(q.inp & K.X) && !(q.prev & K.X);
    if (!go) continue;
    q.prev |= K.X; const ca = chOf(A).cat, cb = chOf(q).cat;
    cut.vs = q.i; cut.res = ca === cb ? 2 : BEATS[ca] === cb ? 0 : 1; // 0: 먼저 쓴 쪽 승, 1: 맞받은 쪽 승, 2: 상쇄
    S.freezeT += 1.1; ev(S, 'clash', NETX, 300, ZD / 2, cut.res); break;
  }
  cut.botChk = true;
}
function stripSpike(S, A) { // 공에 실은 필살기를 튕겨 낸다
  const b = S.ball, c = chOf(A);
  if (b.supTeam === A.team) { b.sup = null; b.home = 0; b.fuse = 0; } b.power = false; S.decoys = []; b.swapT = 0;
  if (S.mom && S.mom.team === A.team) S.mom = null;
  if (c.sup === 'thorn') S.thornF = null; if (c.sup === 'ice') S.ice[1 - A.team] = 0;
}
function endCut(S, cut) {
  const A = S.players[cut.p], pend = S.pend === cut.p; S.pend = -1; if (!A) return;
  if (cut.vs == null) { if (pend) applyInstant(S, A); return; }
  const B = S.players[cut.vs], refund = q => { if (!q.supBan) q.gauge = 50; };
  if (cut.res !== 0) A.supN = Math.max(0, (A.supN | 0) - 1); // 대결에서 지거나 상쇄되면 쓴 횟수에 안 넣는다
  if (cut.res === 2) { if (!pend) stripSpike(S, A); refund(A); refund(B); ev(S, 'txt', NETX, 230, ZD / 2, '상쇄! 게이지 절반 돌려받기', 1, 1); }
  else if (cut.res === 0) { if (pend) applyInstant(S, A); refund(B); ev(S, 'txt', B.x, B.y - 160, B.z, '튕겨냈다…', 2); }
  else { if (!pend) stripSpike(S, A); refund(A); ev(S, 'txt', A.x, A.y - 160, A.z, '튕겨냈다…', 2); B.gauge = 100; trySuper(S, B); }
}
function cutIn(S, p) { p.supN = (p.supN | 0) + 1; tire(p, 4); S.freezeT = 0.8; S.cut = { p: p.i, t: 0 }; ev(S, 'cut', p.x, p.y, p.z, p.i); p.gauge = 0; p.stats.sup++; }
function instantSuper(S, p) { // 컷인만 먼저 띄우고, 효과는 컷인이 끝날 때(그 사이 상대가 맞받으면 상성으로 판정)
  const c = chOf(p), b = S.ball;
  if (c.sup === 'ufo' && (b.cap || b.held || S.ufo)) return;
  cutIn(S, p); S.pend = p.i;
}
function applyInstant(S, p) {
  const c = chOf(p), opp = S.players.filter(q => q.team !== p.team), b = S.ball;
  if (S.boss && ['puppet', 'float', 'wrap', 'half', 'snore'].includes(c.sup)) { bossSuperHit(S, p, c.sup); if (c.sup === 'snore') { p.st.sleep = 0.4; } return; }
  if (c.sup === 'ufo') {
    if (b.cap || b.held || S.ufo) return;
    b.cap = true; b.vx = b.vy = b.vz = 0; b.home = 0; b.lastTeam = p.team; b.lastP = p.i; b.noP = -1; b.touches = 0; b.power = false; b.serial++;
    if (b.sup !== 'hot') b.sup = null;
    S.ufo = { team: p.team, by: p.i, st: 0, t: 0, sx: netD(p.team, 560), sy: -90, sz: ZD / 2, x: netD(p.team, 560), y: -90, z: ZD / 2, bx: 0, by2: 0, bz: 0, dur: rnd(1.7, 2.5), w: rnd(3.6, 4.6), ph: rnd(0, 6.28), w2: rnd(2.2, 3.4), ph2: rnd(0, 6.28) };
    ev(S, 'ufo', b.x, b.y, b.z, p.team);
    return;
  }
  if (c.sup === 'puppet') { for (const q of opp) { q.st.puppet = 30; q.pupN = 1; /* v1.30 2점 → 1점 */ q.pupBy = p.i; q.act = 'idle'; q.chg = 0; q.shk = 0; ev(S, 'jam', q.x, q.y - 100, q.z); if (!q.bot) ev(S, 'txt', q.x, q.y - 190, q.z, '← → 빠르게 번갈아 눌러 풀기!', 2); } }
  else if (c.sup === 'float') { for (const q of opp) { q.st.float = 3.0 * cool(q); q.act = 'idle'; q.chg = 0; q.shk = 0; if (q.gnd) { q.gnd = false; q.vy = -200; } if (!q.bot) ev(S, 'txt', q.x, q.y - 190, q.z, '← → 빠르게 번갈아 눌러 내려오기!', 2); } ev(S, 'float', oppD(p.team, 300), GY - 200, ZD / 2, p.team); }
  else if (c.sup === 'wrap') {
    opp.sort((a, q) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z));
    for (const q of opp.slice(0, 2)) { q.st.wrap = 2.5 * cool(q); q.act = 'idle'; q.chg = 0; ev(S, 'wrap', q.x, q.y - 50, q.z); }
  } else if (c.sup === 'giant') {
    p.st.giant = 12; p.st.shrink = 0; /* v1.15 7초→10초, v1.31 →12초 */ ev(S, 'giant', p.x, p.y - 100, p.z, p.i); ev(S, 'txt', p.x, p.y - 300, p.z, '멍멍!!', 3, 1); ev(S, 'shake', p.x, p.y, p.z, 2);
  } else if (c.sup === 'net') {
    S.netLive = { team: p.team, t: 12, by: p.i, dx: 0, tx: 0, mode: 0 }; /* v0.56 mode 1=우리 토스를 따라 우리 쪽으로 이동, 2=상대 공격을 마중 나가 상대 쪽으로 이동 */ ev(S, 'netlive', NETX, NETTOP, ZD / 2, p.team); ev(S, 'txt', NETX, NETTOP - 120, ZD / 2, '네트가 살아났다!', 1, 1);
  } else if (c.sup === 'half') {
    for (const q of opp) { q.st.half = 8 * cool(q); /* v1.36 5초→8초 */ q.act = 'idle'; q.chg = 0; ev(S, 'half', q.x, q.y - 60, q.z); } ev(S, 'txt', oppD(p.team, 300), 220, ZD / 2, '반띵!! (삐약)', 3, 1);
  } else if (c.sup === 'heal') {
    for (const q of S.players) if (q.team === p.team) { q.hp = 100; if (q.ko) { q.ko = false; q.st.down = 0; } if (q !== p && chOf(q).sup !== 'heal') { q.supCap = (q.supCap || 99) + 1; /* 스너스가 채워 주면 1회 더 */ if (q.supBan) { q.supBan = 0; ev(S, 'txt', q.x, q.y - 170, q.z, '봉인 풀림!', 1); } else q.gauge = Math.min(100, q.gauge + 50); } /* v0.47 우리 편 +50, 봉인은 풀어 주기만 */ q.st.boost = 3; ev(S, 'heal', q.x, q.y - 60, q.z); }
    p.gauge = 0; for (const q of opp) q.gauge = Math.max(0, q.gauge - 25); ev(S, 'txt', p.x, p.y - 200, p.z, '기운 펄펄!', 1, 1); /* v0.45 상대 게이지 -25 */ if (opp[0]) ev(S, 'txt', opp[0].x, opp[0].y - 150, opp[0].z, '부럽다…', 0);
  } else if (c.sup === 'basin') {
    S.basin = { team: p.team, t: 20, by: p.i }; ev(S, 'basinOn', p.x, p.y - 120, p.z, p.team); ev(S, 'txt', p.x, p.y - 190, p.z, '다라이 대기! 공격해 봐~', 2); // v1.12 네트 위에 서 있지 않고 숨어 있다가, 상대가 공격하면 날아와 막는다
  } else if (c.sup === 'snore') {
    for (const q of opp) { q.st.sleep = 3.0 * gutMul(q); q.act = 'idle'; q.chg = 0; ev(S, 'zzz', q.x, q.y - 100, q.z); }
    p.st.sleep = 0.4; ev(S, 'zzz', p.x, p.y - 100, p.z); ev(S, 'txt', p.x, p.y - 160, p.z, '…본인도 잠듦', 0);
  }
}
function hitSuper(S, p) {
  const b = S.ball, c = chOf(p), T = p.team;
  if (supReceive(S, p, true)) return;
  const d = dirKeys(p, p.inp);
  if (!touch(S, p, 'spike')) return;
  cutIn(S, p);
  const tg = spikeTarget(S, p, d), sp = powV(c) * 1.2;
  if (c.sup === 'mom') { // 살짝 넘기면 상대 코트 뒤에서 엄마 돼지가 솟아올라 대신 때린다
    const mz = clamp(tg.z, 60, ZD - 60); b.sup = null; b.power = false; b.float = 0; b.home = 0;
    lob(S, b, oppD(T, 560), mz, GY - 300, GY - 520);
    S.mom = { team: T, st: 0, t: 0, x: oppD(T, 640), z: mz, by: p.i }; ev(S, 'mom', S.mom.x, GY, mz, T); ev(S, 'txt', p.x, p.y - 180, p.z, '엄마아~!', 1, 1);
    ev(S, 'bump', b.x, b.y, b.z, 1); p.stats.spk++; return;
  }
  b.sup = c.sup; b.supTeam = T; b.power = true; b.float = 0; b.home = 0; p.stats.spk++;
  if (c.sup === 'thorn') { drive(S, b, tg.x, tg.z, GY - 200, sp * 0.95); b.home = 2.6; b.power = false; const pts = []; for (let i = 0; i < 5; i++) pts.push([oppD(T, 80 + i * 105 + rnd(-25, 25)), rnd(50, ZD - 50)]); S.thornF = { team: 1 - T, n: 2, pts }; ev(S, 'txt', oppD(T, 330), GY - 40, ZD / 2, '바닥에 가시가!', 3); } // v0.45 상대 바닥 가시: 2점 동안, 밟으면 잠깐 멈춤
  else if (c.sup === 'hot') { drive(S, b, tg.x, tg.z, GY - BR, sp * 0.9); b.fuse = 3.0; }
  else if (c.sup === 'ice') { drive(S, b, tg.x, tg.z, GY - BR, sp); S.ice[1 - T] = 6.5; ev(S, 'freeze', oppD(T, 300), GY - 20, ZD / 2, '빙판 주의!', 3); }
  else if (c.sup === 'bogo') {
    const ds = [[150, 0.25], [345, 0.75], [535, 0.4]].sort(() => Math.random() - 0.5);
    S.decoys = [];
    for (let i = 0; i < 2; i++) { const q = { x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, rot: 0, float: 0 }; drive(S, q, oppD(T, ds[i][0]), ds[i][1] * ZD, GY - BR, sp * rnd(0.9, 1)); S.decoys.push(q); }
    drive(S, b, oppD(T, ds[2][0]), ds[2][1] * ZD, GY - BR, sp * 0.95); b.trick = false; b.swapT = rnd(0.15, 0.32); // v0.45 날아가는 도중 진짜 공이 휴지와 자리를 바꾼다
  }
  ev(S, 'spike', b.x, b.y, b.z, 2, p.i); S.stopT = 0.15; ev(S, 'hit', b.x, b.y, b.z, 3, p.i);
}
function landX(S, b) { const g = ballG(S, b), a = 0.5 * g, c = b.y + BR - GY, d = b.vy * b.vy - 4 * a * c, t = d > 0 ? (-b.vy + Math.sqrt(d)) / (2 * a) : 0.5; return b.x + b.vx * Math.max(0, t); }
function stepNetLive(S) { // v0.56 춤추는 네트가 실제로 자리를 옮긴다
  const L = S.netLive, b = S.ball, T = L.team, own = T === 0 ? -1 : 1; // own = 우리 코트 쪽 방향
  if (L.done) { L.tx = 0; if (S.phase === 'serve' || S.phase === 'swap') { S.netLive = null; return; } if (S.phase === 'rally' && Math.abs(L.dx) < 1) { S.netLive = null; return; } } // v1.15 경기 중 막고 돌아온 네트는 원래 네트로
  else if (S.phase === 'rally' && !L.mode && !b.held && !b.cap) {
    const sd = b.x < NETX ? 0 : 1;
    if (b.lastTeam === T && b.touches >= 2 && sd === T && b.vy < 0) { // 우리가 토스한 공: 네트가 공 뒤로 달려가 공을 상대 코트로 만들어 버린다
      const lx = landX(S, b), edge = T === 0 ? Math.min(b.x, lx) - 90 * XS : Math.max(b.x, lx) + 90 * XS;
      if (edge < 70 * XS || edge > CW - 70 * XS) { /* v1.12 끝선 근처·밖에 떨어질 공: 네트가 공 뒤로 못 가니 따라가지 않는다(전에는 네트 앞에 떨어져 오히려 실점) */ }
      else { L.tx = edge - NETX; L.mode = 1; ev(S, 'txt', NETX, NETTOP - 150, ZD / 2, '네트가 달린다?!', 3, 1); ev(S, 'netlive', NETX, NETTOP, ZD / 2, T); }
    } else if (b.lastTeam === 1 - T && sd === 1 - T && b.vx * own > 60 && Math.abs(b.x - NETX) < 520 * XS && !b.srv) { // 상대 공격: 네트가 마중 나가 공을 막는다
      L.tx = (b.x - NETX) * 0.55; L.mode = 2; ev(S, 'txt', NETX, NETTOP - 150, ZD / 2, '네트가 마중 나간다!', 3, 1); ev(S, 'netlive', NETX, NETTOP, ZD / 2, T);
    }
  }
  if (L.mode === 2 && !L.done && S.phase === 'rally' && !b.held && !b.cap && (b.x - NETX) * own < 0) L.tx = (b.x - NETX) * 0.55; // v1.12 마중 나간 네트는 공을 계속 따라간다(전에는 상대가 네트 앞까지 다시 끌고 와 때리면 네트 뒤로 빠져 실점)
  const v = (L.done ? 900 : 1500) * DT, d = L.tx - L.dx; L.dx += Math.abs(d) < v ? d : Math.sign(d) * v;
  if (L.mode === 1 && !L.done && S.phase !== 'rally') L.done = true;
}
const DARAI_V = 900; // v1.13 시험: 600→55%, 760→62%, 900→68% (막은 뒤 그 점수를 딸 확률)
const NET_VY = 320; // v1.15 막힌 공이 떨어지는 빠르기(시험: 60→72%, 320→77%, 450→89% 득점)
function netCross(S, from) { // 공이 네트를 넘는 순간: 춤추는 네트·고무 다라이. true면 공을 새로 보냈다
  const b = S.ball;
  if (b.cap || b.held) return false;
  if (S.boss && S.boss.cage > 0 && from === 0 && b.y > NETTOP - 120) { b.x = NETX - BR - 8; b.vx = -Math.abs(b.vx) * 0.3 - 60; b.vy = Math.max(120, b.vy * 0.3); b.vz *= 0.4; b.power = false; ev(S, 'bossCageHit', b.x, b.y, b.z); ev(S, 'txt', NETX, NETTOP - 130, b.z, '철망에 막혔다! 더 높이!', 2, 1); return true; } // v1.28 8 철망
  if (S.basin && from !== S.basin.team) { // v1.12 상대 공격이 넘어오면 다라이가 날아와 무조건 막는다(v1.36 스파이크만이 아니라 서브·토스·살짝 넘긴 공 등 넘어오는 모든 공 1번)
    const T = S.basin.team, by = S.players[S.basin.by];
    b.x = from === 0 ? NETX - BR - 6 : NETX + BR + 6; b.sup = null; b.home = 0;
    { const os = openSpot(S, T); drive(S, b, oppD(T, rnd(90, 260)), cz(os[1] + rnd(-50, 50)), GY - BR, DARAI_V); } // v1.13 막은 공은 상대 코트 네트 앞 빈자리로 내리꽂힌다(블로킹처럼). 전에는 살살 넘겨 줘서 상대가 다시 공격해 오히려 실점이 많았다
    b.lastTeam = T; b.lastP = by ? by.i : -1; b.noP = -1; b.touches = 0; b.chain = 0; b.nice = 0; b.power = false; b.serial++; b.teamCd = 0;
    ev(S, 'basinHit', b.x, b.y, b.z, T); S.stopT = 0.24; // 다라이가 날아오는 동안 공을 잠깐 멈춘다(그림이 날아와 맞는 순간 소리·글자)
    S.basin = null; return true;
  }
  if (S.netLive && S.netLive.mode === 2 && !S.netLive.done && from !== S.netLive.team) { // v0.56 마중 나간 네트에 막혀 상대 공이 못 넘어온다
    const L = S.netLive, nx = NETX + L.dx, back = from === 0 ? -1 : 1;
    b.x = nx + back * (BR + 10); b.vx = back * 160; b.vy = Math.max(NET_VY, b.vy * 0.2); b.vz *= 0.3; b.power = false; b.sup = null; b.home = 0;
    b.lastTeam = L.team; b.lastP = L.by; b.touches = 0; b.chain = 0; b.nice = 0; b.serial++; b.teamCd = 0; L.done = true; // v1.15 막은 뒤 네트는 제자리로 돌아가고, 상대는 막힌 공을 다시 받아 칠 수 있다(전에는 아무도 못 건드려 거의 무조건 득점)
    ev(S, 'net', b.x, b.y, b.z); ev(S, 'txt', nx, NETTOP - 100, b.z, '못 넘어와! 네트가 막았다', 3, 1); S.stopT = 0.12; return true;
  }
  if (S.netLive && S.netLive.mode) return false;
  if (S.netLive) {
    const L = S.netLive, T = L.team; S.netLive = null;
    if (from === T) { // 우리 공이 넘어가면 네트가 내리꽂는다
      const os = openSpot(S, T); b.sup = null; b.home = 0; drive(S, b, clamp(os[0] + rnd(-110, 110) * XS, Math.min(oppD(T, 40), oppD(T, 600)), Math.max(oppD(T, 40), oppD(T, 600))), cz(os[1] + rnd(-70, 70)), GY - BR, 1250); // v0.45 빈자리에서 조금 빗나갈 수 있고 덜 세다
      b.lastTeam = T; b.lastP = L.by; b.touches = 0; b.power = true; b.serial++;
      ev(S, 'hit', b.x, b.y, b.z, 3, -1); ev(S, 'txt', NETX, NETTOP - 100, b.z, '네트 스파이크!!', 3, 1); S.stopT = 0.12;
    } else { // 상대 공은 네트가 쭉 늘어나 낚아챈다 → 상대 코트로 떨어진다
      b.x = from === 0 ? NETX - BR - 8 : NETX + BR + 8; b.vx = (from === 0 ? -1 : 1) * 70; b.vy = 40; b.vz *= 0.2; b.power = false; b.sup = null; b.home = 0;
      ev(S, 'net', b.x, b.y, b.z); ev(S, 'txt', NETX, NETTOP - 100, b.z, '철컥! 네트가 낚았다', 3, 1); S.stopT = 0.12;
    }
    ev(S, 'txt', NETX, NETTOP - 40, ZD / 2, '멍!', 0); return true;
  }
  return false;
}
function openSpot(S, T) { // T팀이 노릴 상대 코트의 빈자리
  let best = null, bd = -1; for (let i = 0; i < 24; i++) { const cx = oppD(T, rnd(60, 420)), cz2 = rnd(40, ZD - 40); let d = 1e9; for (const o of S.players) if (o.team !== T && !o.ko) d = Math.min(d, Math.hypot(o.x - cx, (o.z - cz2) * 1.4)); if (d > bd) { bd = d; best = [cx, cz2]; } }
  return best;
}
function stepMom(S) { // 엄마 돼지: 솟아올라(0) → 공이 오면 때리고(1) → 들어간다(2)
  const m = S.mom, b = S.ball; m.t += DT;
  if (m.st === 0) {
    if (S.phase !== 'rally' || b.lastTeam !== m.team || b.cap) { m.st = 2; m.t = 0; return; } // 상대가 먼저 건드렸으면 그냥 들어간다
    const hx = m.x, hy = GY - 330;
    if (m.t > 0.35 && !b.held && (d3(b.x, b.y, b.z, hx, hy, m.z) < 150 || (b.vy > 0 && b.y > hy - 20 && Math.abs(b.x - hx) < 260))) {
      b.x = hx + (m.team === 0 ? -1 : 1) * 20; b.y = Math.min(b.y, hy); b.z = m.z; b.home = 0;
      const best = openSpot(S, m.team); // 엄마는 빈자리를 귀신같이 안다
      drive(S, b, best[0], best[1], GY - BR, 1600);
      b.sup = 'mom'; b.supTeam = m.team; b.power = true; b.lastTeam = m.team; b.lastP = m.by; b.touches = 0; b.serial++;
      ev(S, 'hit', b.x, b.y, b.z, 3, -1); ev(S, 'spike', b.x, b.y, b.z, 1, -1); ev(S, 'txt', hx, GY - 420, m.z, '누가 우리 애 울렸어!', 3, 1); S.stopT = 0.14;
      m.st = 1; m.t = 0;
    } else if (m.t > 4) { m.st = 2; m.t = 0; }
  } else if (m.t > 1.1) S.mom = null;
}
function stepStage(S) { // 경기장 장치: 목욕탕 수증기, 옥상 비둘기, 화산 군고구마
  const b = S.ball, e = S.env;
  if (S.flux > 0 && (S.flux -= DT) <= 0) { e.g = e.g0; ev(S, 'txt', NETX, 200, ZD / 2, '중력 복귀', 0); }
  for (const q of S.steams) q.t -= DT; if (S.steams.length) S.steams = S.steams.filter(q => q.t > 0);
  for (const q of S.pots) {
    q.t -= DT;
    if (q.t <= 0 && !q.hit) { q.hit = true; ev(S, 'potato', q.x, GY, q.z);
      for (const p of S.players) if (!p.ko && Math.hypot(p.x - q.x, (p.z - q.z) * 1.3) < 52 * psc(p) + 18) { knock(S, p, 0.9, p.x > q.x ? 1 : -1); hurt(S, p, 8); ev(S, 'bonk', p.x, p.y - 60, p.z, '앗뜨!', 3); } }
  }
  if (S.pots.length) S.pots = S.pots.filter(q => q.t > -0.6);
  if (S.pig) { const g = S.pig; g.t += DT;
    if (g.st === 0 && g.t > 0.9) { g.st = 1; g.t = 0; }
    else if (g.st === 1) { const k = Math.min(1, g.t / 0.45); g.x += (b.x - g.x) * k; g.y += (b.y - g.y) * k; g.z += (b.z - g.z) * k;
      if (S.phase !== 'rally' || b.held || b.cap) { g.st = 2; g.t = 0; }
      else if (g.t > 0.45 || d3(g.x, g.y, g.z, b.x, b.y, b.z) < 30) { b.vx += rnd(-1, 1) * 260; b.vz += rnd(-1, 1) * 160; b.vy = Math.min(b.vy, -rnd(150, 320)); ev(S, 'txt', b.x, b.y - 50, b.z, '퍽! (구구)', 2); ev(S, 'pigeon', b.x, b.y, b.z); g.st = 2; g.t = 0; }
    } else if (g.st === 2) { g.x += 600 * DT * g.dir; g.y -= 300 * DT; if (g.t > 1.6) S.pig = null; }
  }
  if (S.shoe) { const h = S.shoe; if (!h.gnd) { h.vy += 1500 * S.env.g * DT; h.x += h.vx * DT; h.y += h.vy * DT; h.z = clamp(h.z + h.vz * DT, 10, ZD - 10); h.rot += 14 * DT * Math.sign(h.vx || 1);
      if (h.hit < 0) for (const q of S.players) if (q.i !== h.by && q.team !== S.players[h.by].team && !q.ko && d3(q.x, q.y - 60 * psc(q), q.z, h.x, h.y, h.z) < 60 * psc(q)) { h.hit = q.i; q.st.stun = Math.max(q.st.stun, 0.3); h.vx *= -0.3; h.vy = -260; ev(S, 'bonk', q.x, q.y - 60, q.z, '신발에 퍽!', 3); break; }
      if (h.y >= GY - 8) { h.y = GY - 8; if (Math.abs(h.vy) > 200) { h.vy *= -0.35; h.vx *= 0.5; } else { h.gnd = 1; h.vx = h.vy = h.vz = 0; } }
      if (h.x < -200 || h.x > CW + 200) { h.gnd = 1; h.vx = 0; } } }
  if (S.guest) { const q = S.guest, run = S.phase === 'rally'; q.t += DT; // v0.95 깜짝 손님: 강아지는 앞쪽을 가로질러 달리고, 고양이는 들어와 앉았다가 돌아간다(경기 중이 되면 서둘러 나감)
    if (q.k === 0) q.x += q.dir * (run ? 1100 : 640) * DT;
    else if (q.st === 0) { q.x += q.dir * 230 * DT; if (q.t > 1.3 || run) { q.st = run ? 2 : 1; q.t = 0; if (!run) ev(S, 'txt', q.x, GY - 110, q.z, '야옹~', 0); } }
    else if (q.st === 1) { if (q.t > 1.4 || run) { q.st = 2; q.t = 0; } }
    else q.x -= q.dir * (run ? 900 : 330) * DT;
    if (q.x < -280 || q.x > CW + 280) S.guest = null; }
  if (S.phase !== 'rally') return;
  if (!e.pigeon && !S.tut && !S.boss) { S.gpT = (S.gpT == null ? rnd(50, 90) : S.gpT) - DT; // v0.95 깜짝 손님: 다른 경기장에도 아주 가끔 비둘기(0.9초 전에 미리 보인다)
    if (S.gpT <= 0) { if (S.pig || b.held || b.cap || b.y > GY - 260) S.gpT = 0.5; else { S.gpT = rnd(90, 150); const dir = Math.random() < 0.5 ? 1 : -1; S.pig = { st: 0, t: 0, x: dir > 0 ? -60 : CW + 60, y: 120, z: b.z, dir }; ev(S, 'txt', b.x, 200, b.z, '구구?', 2); } } }
  S.envT -= DT; if (S.envT > 0) return;
  if (e.steam) { S.envT = rnd(15, 22); for (let i = 0; i < 2; i++) S.steams.push({ x: rnd(CW * 0.15, CW * 0.85), z: rnd(ZD * 0.2, ZD * 0.8), t: 4.5, r: rnd(150, 230) * XS }); ev(S, 'steam', NETX, GY - 200, ZD / 2); }
  else if (e.pigeon) { if (b.held || b.cap || b.y > GY - 260 || S.pig) { S.envT = 0.5; return; } S.envT = rnd(19, 28); const dir = Math.random() < 0.5 ? 1 : -1; S.pig = { st: 0, t: 0, x: dir > 0 ? -60 : CW + 60, y: 120, z: b.z, dir }; ev(S, 'txt', b.x, 200, b.z, '구구?', 2); }
  else if (e.quake) { S.envT = rnd(24, 36); ev(S, 'quake', NETX, GY, ZD / 2); ev(S, 'shake', NETX, GY, ZD / 2, 2); ev(S, 'txt', NETX, 170, ZD / 2, '쿠웅! 군고구마 주의!', 3, 1);
    const n = S.n + 2; for (let i = 0; i < n; i++) { const tgt = Math.random() < 0.6 ? S.players[Math.floor(Math.random() * S.players.length)] : null; S.pots.push({ x: clamp(tgt ? tgt.x + rnd(-70, 70) : rnd(60, CW - 60), 40, CW - 40), z: clamp(tgt ? tgt.z + rnd(-50, 50) : rnd(30, ZD - 30), 20, ZD - 20), t: rnd(1.2, 1.9), hit: false }); } }
  else if (e.sand) { S.envT = rnd(26, 38); const T = Math.random() < 0.5 ? 0 : 1; ev(S, 'wave', netD(T, 540), GY, ZD / 2, T); ev(S, 'txt', netD(T, 420), 230, ZD / 2, '파도다!', 3); for (const p of S.players) if (p.team === T && Math.abs(p.x - NETX) > 420 * XS) { p.st.wet2 = 2.5; ev(S, 'txt', p.x, p.y - 140, p.z, '첨벙!', 2); } } // v0.51 백사장: 파도가 코트 뒤쪽을 덮쳐 2.5초 느려짐
  else if (e.fest) { S.envT = rnd(60, 80); /* v1.26 30~40초 → 60~80초 */ if (S.itemsOn) { spawnItem(S, 0); spawnItem(S, 1); ev(S, 'txt', NETX, 210, ZD / 2, '떨이 세일!', 3, 1); } } // v0.51 야시장: 아이템 두 개가 한꺼번에
  else if (e.flux) { S.envT = rnd(30, 42); S.flux = 5; e.g = 0.5; ev(S, 'txt', NETX, 200, ZD / 2, '무중력 돌풍!', 3, 1); ev(S, 'shake', NETX, GY, ZD / 2, 1); } // v0.51 외계의 별: 5초 동안 중력이 더 약해짐
  else S.envT = 99;
}
function explode(S) {
  const b = S.ball, side = sideOf(b.x);
  ev(S, 'boom', b.x, b.y, b.z, side);
  for (const q of S.players) if (q.team === side) { knock(S, q, 1.5, q.x > b.x ? 1 : -1); q.soot = 8; hurt(S, q, 28); }
  ev(S, 'txt', b.x, b.y - 60, b.z, '펑!!', 3);
  b.sup = null; b.fuse = 0; b.power = false; b.touches = 0; b.noP = -1; b.serial++;
  if (S.phase === 'rally') { b.vy = -940; b.vx = rnd(-170, 170); b.vz = rnd(-90, 90); }
}
function trySuper(S, p) {
  const c = chOf(p); if (supLocked(p)) { p.gauge = 0; return; }
  if (c.type === 'instant') { if (S.phase === 'rally') instantSuper(S, p); return; }
  p.act = 'super'; p.actT = 0; p.hitDone = false; p.perfect = false; p.chg = 0;
}

/* ---------- 서브 ---------- */
function doServe(S, p, power, inp, chg, flt) {
  const b = S.ball, c = chOf(p), d = aimKeys(p, inp), T = p.team, f = fdir(p);
  b.held = false; b.lastTeam = T; b.lastP = p.i; b.noP = p.i; b.touches = 0; b.serial++; b.teamCd = 0.3; p.hitCd = 0.4; b.out = false; b.srv = true; b.ceilFault = false; tire(p, power ? 2 : 0.5);
  if (c.id === 'banban') { p.bw = (p.bw | 0) ^ 1; ev(S, 'txt', p.x, p.y - 150, p.z, p.bw ? '흑!' : '백!', 0); }
  const free = !p.bot && p.aimOn && p.aimSx != null, ek = free ? 0.6 : 1, dist = free ? p.aimSx : d.fwd ? 520 : d.back ? 190 : 350, e = rnd(-1, 1) * (6 - tq(c)) * 13 * ek, tz = (free ? p.aimSz : laneZ(p, d, p.z)) + rnd(-1, 1) * (6 - tq(c)) * 10 * ek; // v1.36 사람은 고른 곳으로(흔들림도 조금 줄임)
  b.z = p.z;
  if (power) {
    b.x = p.x + f * 22; b.y = p.y - 215; p.vy = -560; p.gnd = false;
    const ultra = chg >= 0.95 && !(p.st.half > 0); b.ultra = ultra; // v0.51 게이지 95% 이상 = 초강서브(파란 불꽃)
    drive(S, b, oppD(T, dist) + e, tz, GY - BR, powV(c) * fat(p) * (0.58 + 0.36 * chg) * (p.st.half > 0 ? 0.6 : 1) * (ultra ? 1.12 : 1)); b.power = chg > 0.5 && !(p.st.half > 0);
    if (ultra) ev(S, 'txt', p.x, p.y - 200, p.z, '초강서브!!', 1, 1);
    if (chg >= 0.95 && Math.random() < SERVE_OUT_P) { b.out = true; b.outK = 'serve'; drive(S, b, oppD(T, 640 + rnd(35, 80)), tz, GY - BR, powV(c) * fat(p) * (0.58 + 0.36 * chg) * (ultra ? 1.12 : 1)); } // 너무 세게 때려 끝선 밖으로
    p.act = 'spike'; p.actT = 0.05; p.hitDone = true; ev(S, 'spike', b.x, b.y, b.z, chg >= 0.97 ? 1 : 0, p.i); S.stopT = ultra ? 0.08 : 0.04; ev(S, 'hit', b.x, b.y, b.z, chg >= 0.97 ? 3 : 1, p.i);
  } else if (flt) { b.x = p.x + f * 26; b.y = p.y - 150; drive(S, b, oppD(T, dist) + e, tz, GY - BR, powV(c) * fat(p) * 0.6); b.flt = 1.6; b.fph = rnd(0, 6.28); p.act = 'spike'; p.actT = 0.05; p.hitDone = true; ev(S, 'bump', b.x, b.y, b.z, 1); ev(S, 'txt', p.x, p.y - 170, p.z, '플로터!', 0); } // 흔들리며 날아가는 서브
  else { b.x = p.x + f * 26; b.y = p.y - 78; lobOver(S, b, T, dist, tz, e / XS, GY - 480); /* v1.36 네트 가까이 노려도 넘어가게 필요하면 더 높이 */ p.act = 'bump'; p.actT = 0.05; p.hitDone = true; ev(S, 'bump', b.x, b.y, b.z, 0); }
  p.chg = 0;
  S.phase = 'rally'; S.phaseT = 0; ev(S, 'serve', b.x, b.y, b.z);
}

/* ---------- 선수 ---------- */
function ballNear(S, p, mul) {
  const b = S.ball, s = psc(p), f = fdir(p);
  if (b.held || b.cap) return false;
  const ck = ctl(S, p), reach = 96 * s * (chOf(p).id === 'jiae' ? 1.2 : chOf(p).id === 'snurse' ? 1.05 : 1) * roleK(p, 'reach') * mul * ck.reach * prsK(S, p) * (!p.bot && b.lastTeam >= 0 && b.lastTeam !== p.team ? RCV_K : 1);
  return Math.hypot(b.x - p.x - f * 10 * s, b.y - p.y + 56 * s, (b.z - p.z) * ck.zk) < reach; // 2.5D라 깊이를 맞추기 어렵다 → 깊이 차이는 덜 따진다
}
/* v0.60~0.61 온라인 전용: 내 캐릭터의 이동·점프·동작(받기·모으기·스파이크·블로킹·다이빙)을 화면에서 먼저 계산한다.
   stepPlayer 의 해당 부분과 같은 공식(타격 판정·필살기·체력은 서버만). stepPlayer 의 이동·동작 규칙을 바꾸면 여기도 같이 고칠 것.
   S = 가장 최근에 받은 서버 상태(+ env, pred), p = 내 캐릭터 사본, inp = 그 틱의 키, edge = 그 틱에 새로 눌린 키 */
function predMove(S, p, inp, edge) {
  useCourt(S.n);
  const c = chOf(p), s = p.st, inc = busy(p), ice = S.ice[p.team] > 0, ck = ctl(S, p), b = S.ball, serving = S.phase === 'serve' && S.server === p.i;
  let mx = 0, mz = 0;
  if (!inc && p.act !== 'dive') { mx = ((inp & K.R) ? 1 : 0) - ((inp & K.L) ? 1 : 0); mz = ((inp & K.D) ? 1 : 0) - ((inp & K.U) ? 1 : 0); }
  if (serving) { const hx = netD(p.team, SRV); if ((p.x - hx) * mx > 0 && Math.abs(p.x - hx) > 28 * XS) mx = 0; }
  const aimAir = ck.assist > 0 && !p.gnd && (p.act === 'charge' || p.act === 'spike' || (p.jumpHold && p.act === 'idle')) && !serving && !inc;
  if (aimAir) {
    const ux = mx, uz = mz, ak = AIR_K * Math.min(1.08, ck.assist / 1.12); /* v1.21 도움을 약하게: 방향키 + 끄는 힘 일부 */
    if (S.phase === 'rally' && !b.held && !b.cap && !noTouch(S, p) && (sideOf(b.x) === p.team || Math.abs(b.x - NETX) < 90 * XS) && Math.abs(b.x - p.x) < AIR_R * XS) {
      const sc = psc(p), tx = b.x + b.vx * AIR_LEAD - fdir(p) * 16 * sc, tz = b.z + b.vz * AIR_LEAD;
      mx = clamp((tx - p.x) / 30, -1, 1) * ak; mz = clamp((tz - p.z) / 24, -1, 1) * ak * AIR_ZK; /* v1.40 점프 중 공 근처에서는 방향키로 몸이 움직이지 않고 자동 이동만(방향키는 때릴 곳만 고름). v1.39: 방향키 12%, 그 전 70% */ /* v1.22 앞뒤 끌기는 더 약하게 */
    }
  }
  if (mx && mz && !aimAir) { mx *= 0.7071; mz *= 0.7071; }
  if (!aimAir && ck.assist > 0 && !inc && !serving && p.act !== 'dive' && S.phase === 'rally' && !(inp & (K.U | K.D)) && !noTouch(S, p)) {
    const L = S.pred && S.pred.land; let tz = null;
    if (!b.held && !b.cap) { if (!p.gnd && Math.abs(b.x - p.x) < 190) tz = b.z; else if (p.gnd && L && sideOf(L.x) === p.team && Math.abs(L.x - p.x) < DEP_R) tz = L.z; }
    if (tz !== null && Math.abs(tz - p.z) > 5) mz = clamp((tz - p.z) / 36, -1, 1) * Math.min(1, (p.gnd ? DEP_K : DEP_AIR) * ck.assist);
  }
  if (p.act === 'dive') {
    if (p.actT < 0.26) { const v = 600 + (c.id === 'sene' ? 260 : 0); p.vx = p.diveX * v; p.vz = p.diveZ * v; }
    else { const fr = (ice ? 600 : S.env.slip ? 1300 : S.env.wet ? 1900 : 2600) * DT, v = Math.hypot(p.vx, p.vz); if (v > fr) { p.vx *= (v - fr) / v; p.vz *= (v - fr) / v; } else p.vx = p.vz = 0; }
    const rem = (p.diveLen || 0) - Math.hypot(p.x - p.diveX0, p.z - p.diveZ0), v = Math.hypot(p.vx, p.vz);
    if (rem <= 0) p.vx = p.vz = 0; else if (v * DT > rem) { p.vx *= rem / DT / v; p.vz *= rem / DT / v; }
  } else {
    const spd = pSpeed(S, p) * (p.act === 'charge' && p.gnd ? 0.6 : 1);
    if (S.env.slip) p.mom = p.gnd && (mx || mz) && !inc ? Math.min(1, (p.mom || 0) + DT * 0.8) : Math.max(0, (p.mom || 0) - DT * 1.5);
    const k = aimAir ? 1.3 : 1, acc = (p.gnd ? (ice ? 620 : (inc ? 1700 : (S.env.slip ? (mx || mz ? 950 : 560) : S.env.wet ? 3000 : 4600))) : (inc ? 0 : 2200)) * DT;
    p.vx += clamp(mx * spd * k - p.vx, -acc, acc); p.vz += clamp(mz * spd * k - p.vz, -acc, acc);
  }
  let jumped = false;
  if (!inc && p.gnd && p.act !== 'dive' && !serving && (edge & K.S) && p.act !== 'charge') { p.vy = -jumpV(p); p.gnd = false; p.jumpHold = true; jumped = true; }
  if (!p.gnd) p.vy += pGrav(S, p) * DT;
  const px0 = p.x;
  p.y += p.vy * DT; p.x += p.vx * DT; p.z += p.vz * DT;
  if (p.y >= GY) { if (!p.gnd) { p.gnd = true; if (p.act === 'spike' || p.act === 'block' || p.act === 'super' || p.act === 'charge' || p.act === 'bump') { p.act = 'idle'; p.chg = 0; } } p.y = GY; p.vy = 0; }
  const m = 24 * psc(p), out = 85 * XS;
  const NX = NETX + (S.netLive ? S.netLive.dx || 0 : 0); // v1.36 멍베크 네트가 움직이면 선수도 밀려서 자기 코트에 남는다
  if (p.team === 0) { const lo = serving ? -out : Math.min(m, px0); if (p.x < lo) { p.x = lo; p.vx = 0; } if (p.x > NX - NETW / 2 - m) { p.x = NX - NETW / 2 - m; p.vx = Math.min(0, p.vx); } }
  else { const hi = serving ? CW + out : Math.max(CW - m, px0); if (p.x > hi) { p.x = hi; p.vx = 0; } if (p.x < NX + NETW / 2 + m) { p.x = NX + NETW / 2 + m; p.vx = Math.max(0, p.vx); } }
  if (p.z < 14) { p.z = 14; p.vz = 0; } if (p.z > ZD - 14) { p.z = ZD - 14; p.vz = 0; }
  // ----- 동작(모션만. 맞았는지는 서버가 정한다) -----
  const canAct = !inc && !jumped && (p.act === 'idle' || p.act === 'charge' || (p.act !== 'dive' && p.actT > 0.2));
  if (canAct && S.phase === 'rally') {
    let press = edge;
    if (p.jumpHold) { if (!(inp & K.S) || p.gnd) p.jumpHold = false; else if (p.vy > -jumpV(p) * 0.8) { p.jumpHold = false; if (p.act === 'idle') press |= K.S; } }
    if ((edge & K.X) && p.gauge >= 100) { /* 필살기는 서버 결과를 기다린다 */ }
    else if (press & K.A) {
      const mate = p.gnd && !ballNear(S, p, 1.6) ? S.players.find(q => q.i !== p.i && q.team === p.team && (q.st.down > 0.3 || q.ko) && Math.hypot(q.x - p.x, q.z - p.z) < 80 * XS) : null;
      if (mate) { /* 팀원 일으키기: 동작 없음 */ }
      else if (p.gnd && (mx || mz) && !ballNear(S, p, 1.25)) {
        const v = Math.hypot(mx, mz), maxD = DIVE_LEN * roleK(p, 'dive') * (c.id === 'sene' ? 1.45 : 1) * (S.env.slip || ice ? 1.3 : 1), L = S.pred && S.pred.land;
        p.act = 'dive'; p.actT = 0; p.diveX = mx / v; p.diveZ = mz / v; p.diveX0 = p.x; p.diveZ0 = p.z; p.diveLen = maxD; p.chg = 0;
        if (ck.assist > 0 && L && !b.held && !b.cap && sideOf(L.x) === p.team) { const dx = L.x - p.x, dz = L.z - p.z, dd = Math.hypot(dx, dz); if (dd > 1) { const ax = p.diveX * (1 - DIV_K) + dx / dd * DIV_K, az = p.diveZ * (1 - DIV_K) + dz / dd * DIV_K, al = Math.hypot(ax, az) || 1; p.diveX = ax / al; p.diveZ = az / al; p.diveLen = Math.min(maxD, Math.max(0, dd - 30)); } }
      }
      else { p.act = 'bump'; p.actT = 0; p.chg = 0; }
    } else if ((press & K.S) && p.act !== 'charge' && !p.gnd) {
      const blk = Math.abs(p.x - NETX) < 135 * XS && !b.held && !b.cap && ((b.lastTeam >= 0 && b.lastTeam !== p.team && sideOf(b.x) !== p.team) || (S.boss && S.boss.hold && p.team === 0)); // v1.37 보스가 공을 들고 있을 때도 블로킹(카운터)할 수 있게
      if (blk) { p.act = 'block'; p.actT = 0; } else { p.act = 'charge'; p.actT = 0; p.chg = 0; }
    }
  }
  if (p.act === 'charge') { if (serving) { /* 서브 모으기는 서버만 */ } else if (inp & K.S) p.chg = Math.min(1, (p.chg || 0) + DT / (p.bot ? 0.42 : SPK_CHG)); else { p.act = 'spike'; p.actT = 0; } }
  else if (p.act !== 'idle') { p.actT += DT; const dur = p.act === 'bump' ? 0.32 : p.act === 'spike' ? 0.36 : p.act === 'super' ? 0.55 : p.act === 'dive' ? (S.env.sand ? 0.62 : 0.82) : 9; if (p.actT >= dur) { p.act = 'idle'; p.actT = 0; } }
}
const SUP_ST = new Set(['giant', 'shrink', 'half', 'float', 'wrap', 'boost', 'sleep']);
function stepPlayer(S, p) {
  if (p.gone) { p.x = p.team === 0 ? -900 : CW + 900; p.vx = p.vz = 0; p.inp = 0; return; } // v0.95 도전 모드: 상대가 없는 종목
  const c = chOf(p), s = p.st;
  const wasFloat = s.float > 0, wasGiant = s.giant > 0;
  const live = S.phase === 'rally' || S.tut; // v1.36 필살기로 걸린 효과(거대화·반띵·둥실·김밥·잠·부스트)는 경기가 진행 중일 때만 시간이 간다
  for (const k in s) if (s[k] > 0 && (live || !SUP_ST.has(k))) s[k] = Math.max(0, s[k] - DT);
  if (p.big > 0) p.big -= DT; if (p.mini > 0) p.mini -= DT; if (p.fast > 0) p.fast -= DT; if (p.soot > 0) p.soot -= DT; if (p.hitCd > 0) p.hitCd -= DT;
  if (wasGiant && s.giant <= 0) { s.shrink = 1.3; s.stun = Math.max(s.stun, 0.7); ev(S, 'txt', p.x, p.y - 120, p.z, '깨갱…', 2); }
  if (s.giant > 0 && live && Math.round(s.giant / DT) % 95 === 0) { ev(S, 'txt', p.x, p.y - 290, p.z, '멍!!', 3); ev(S, 'shake', p.x, p.y, p.z, 1); for (const q of S.players) if (q.team !== p.team && !q.ko && q.gnd && q.st.down <= 0) { q.st.stun = Math.max(q.st.stun, 0.35 * cool(q)); q.act = 'idle'; q.chg = 0; ev(S, 'txt', q.x, q.y - 130, q.z, '움찔!', 0); } } // 짖을 때마다 상대가 움찔
  if (s.down > 0 && S.players.some(q => q !== p && q.team === p.team && chOf(q).id === 'snurse' && !q.ko && q.st.down <= 0 && Math.hypot(q.x - p.x, q.z - p.z) < 300)) s.down = Math.max(0, s.down - DT); // 스너스 응급처치: 근처면 두 배 빨리 일어난다
  if (c.id === 'snurse' && S.phase !== 'rally' && !p.ko) p.hp = Math.min(100, p.hp + STA.rest * DT);
  if (p.ko && s.down <= 0) { p.ko = false; p.hp = 55; ev(S, 'txt', p.x, p.y - 150, p.z, '부활!', 1); }
  if (!p.ko) { const mv = Math.hypot(p.vx, p.vz); if (S.phase !== 'rally') p.hp = Math.min(100, p.hp + STA.rest * DT); else if (p.gnd && mv < 40 && p.act === 'idle') p.hp = Math.min(100, p.hp + STA.idle * DT); else if (p.gnd) tire(p, (mv > pSpeed(S, p) * 0.6 ? STA.run : STA.walk) * DT, 1); if (p.hp < 30 && !p.tiredMsg) { p.tiredMsg = 1; ev(S, 'txt', p.x, p.y - 150, p.z, '헉헉…', 0); } else if (p.hp > 45) p.tiredMsg = 0; }
  let inp = p.inp;
  if (s.rev > 0 && !p.bot) inp = (inp & ~15) | (inp & 1 ? 2 : 0) | (inp & 2 ? 1 : 0) | (inp & 4 ? 8 : 0) | (inp & 8 ? 4 : 0); // v1.28 보스 저주: 방향키 반대
  const raw = p.inp & ~p.prevIn; p.prevIn = p.inp;
  if (!p.bot && (raw & K.A) && s.down > 0.1 && s.down < 0.5 && !p.ko && !(s.flat > 0)) { s.down = 0; ev(S, 'txt', p.x, p.y - 120, p.z, '벌떡!', 1); } // v0.55 넘어졌을 때 마지막 순간에 A = 바로 일어남
  if (!p.bot && raw && (s.down > 0 || s.stun > 0 || s.frozen > 0 || s.sleep > 0)) { // 연타로 빨리 일어나기
    const k = p.ko ? 0.035 : 0.07; for (const n of ['down', 'stun', 'frozen', 'sleep', 'flat']) if (s[n] > 0) s[n] = Math.max(0, s[n] - k);
    ev(S, 'wig', p.x, p.y - 50, p.z, p.i);
  }
  if (!p.bot && (s.puppet > 0 || s.float > 0)) { // v1.15 해킹·무중력은 좌우 방향키를 번갈아 빠르게 누르면 풀린다
    p.shk = Math.max(0, (p.shk || 0) - DT * 1.5); const d = (raw & K.L) ? 1 : (raw & K.R) ? 2 : 0;
    if (d && p.lastLR && d !== p.lastLR) { p.shk++; ev(S, 'wig', p.x, p.y - 50, p.z, p.i);
      if (s.float > 0) { s.float = Math.max(0, s.float - 0.22); if (s.float <= 0) ev(S, 'txt', p.x, p.y - 150, p.z, '버둥버둥 탈출!', 1); }
      if (s.puppet > 0 && p.shk >= 10) { s.puppet = 0; p.pupN = 0; p.shk = 0; ev(S, 'txt', p.x, p.y - 150, p.z, '해킹 풀림!', 1); } }
    if (d) p.lastLR = d;
  } else p.shk = 0;
  if (s.flat <= 0 && p.wasFlat && p.gnd) { p.vy = -330; p.gnd = false; ev(S, 'txt', p.x, p.y - 120, p.z, '뿅!', 1); }
  p.wasFlat = s.flat > 0;
  if (s.puppet > 0 && !(S.phase === 'serve' && S.server === p.i)) { // 해킹당함(v1.30: 1점 동안(전 2점), 서브하는 사람은 서브만 자유롭게): 조종자의 입력을 좌우 반전해서 따라 한다(점프만 허용)
    const src = S.players[p.pupBy]; const si = src ? src.inp : 0;
    inp = ((si & 1) << 1) | ((si & 2) >> 1) | (si & (K.U | K.D)) | (p.gnd ? (si & K.S) : 0);
  }
  const serving = S.phase === 'serve' && S.server === p.i;
  if (serving && !p.atSrv) { const hx0 = netD(p.team, SRV); if (Math.abs(p.x - hx0) < 12) p.atSrv = true; else if (S.phaseT > 3.5) { p.x = hx0; p.vx = 0; p.atSrv = true; } }
  const toSrv = serving && !p.atSrv, inc = busy(p), reset = (S.phase === 'serve' && (S.phaseT < 0.9 || toSrv)) || S.phase === 'swap';
  let mx = 0, mz = 0;
  const spd = pSpeed(S, p) * (p.act === 'charge' && p.gnd ? 0.6 : 1) * (toSrv ? 1.7 : 1), ice = S.ice[p.team] > 0;
  if (reset) { const h = home(S, p); mx = Math.abs(h[0] - p.x) < 10 ? 0 : (h[0] > p.x ? 1 : -1); mz = Math.abs(h[1] - p.z) < 10 ? 0 : (h[1] > p.z ? 1 : -1); inp = 0; }
  else if (!inc && p.act !== 'dive') { mx = ((inp & K.R) ? 1 : 0) - ((inp & K.L) ? 1 : 0); mz = ((inp & K.D) ? 1 : 0) - ((inp & K.U) ? 1 : 0); }
  if (serving && !reset) { const hx = netD(p.team, SRV); if ((p.x - hx) * mx > 0 && Math.abs(p.x - hx) > 28 * XS) mx = 0; }
  const ck = ctl(S, p);
  // 스파이크 조준: S로 뛰어 힘을 모으는(또는 휘두르는) 동안에는 공을 칠 자리로 저절로 날아가고, 방향키는 때릴 곳(상대 코트)만 고른다
  const aimAir = !p.bot && ck.assist > 0 && !p.gnd && (p.act === 'charge' || p.act === 'spike' || (p.jumpHold && p.act === 'idle')) && !serving && !inc && !reset && s.puppet <= 0 && s.wrap <= 0 && s.float <= 0;
  if (aimAir) {
    const b = S.ball, ux = mx, uz = mz, ak = AIR_K * Math.min(1.08, ck.assist / 1.12); /* v1.21 도움을 약하게: 방향키 + 끄는 힘 일부 */
    if (S.phase === 'rally' && !b.held && !b.cap && !noTouch(S, p) && (sideOf(b.x) === p.team || Math.abs(b.x - NETX) < 90 * XS) && Math.abs(b.x - p.x) < AIR_R * XS) {
      const sc = psc(p), tx = b.x + b.vx * AIR_LEAD - fdir(p) * 16 * sc, tz = b.z + b.vz * AIR_LEAD;
      mx = clamp((tx - p.x) / 30, -1, 1) * ak; mz = clamp((tz - p.z) / 24, -1, 1) * ak * AIR_ZK; /* v1.40 점프 중 공 근처에서는 방향키로 몸이 움직이지 않고 자동 이동만(방향키는 때릴 곳만 고름). v1.39: 방향키 12%, 그 전 70% */ /* v1.22 앞뒤 끌기는 더 약하게 */
    }
  }
  if (mx && mz && !aimAir) { mx *= 0.7071; mz *= 0.7071; }
  if (!aimAir && !p.bot && ck.assist > 0 && !inc && !reset && !serving && p.act !== 'dive' && S.phase === 'rally' && s.puppet <= 0 && s.wrap <= 0 && !(inp & (K.U | K.D)) && !noTouch(S, p)) { // 깊이 자동 맞춤
    const b = S.ball, L = S.pred && S.pred.land; let tz = null;
    if (!b.held && !b.cap) {
      if (!p.gnd && Math.abs(b.x - p.x) < 190) tz = b.z;
      else if (p.gnd && L && sideOf(L.x) === p.team && Math.abs(L.x - p.x) < DEP_R) tz = L.z;
    }
    if (tz !== null && Math.abs(tz - p.z) > 5) mz = clamp((tz - p.z) / 36, -1, 1) * Math.min(1, (p.gnd ? DEP_K : DEP_AIR) * ck.assist);
  }
  if (p.act === 'dive') { // 정해진 거리(diveLen)만큼만 미끄러진다
    if (p.actT < 0.26) { const v = 600 + (c.id === 'sene' ? 260 : 0); p.vx = p.diveX * v; p.vz = p.diveZ * v; }
    else { const fr = (ice ? 600 : S.env.slip ? 1300 : S.env.wet ? 1900 : 2600) * DT, v = Math.hypot(p.vx, p.vz); if (v > fr) { p.vx *= (v - fr) / v; p.vz *= (v - fr) / v; } else p.vx = p.vz = 0; }
    const rem = (p.diveLen || 0) - Math.hypot(p.x - p.diveX0, p.z - p.diveZ0), v = Math.hypot(p.vx, p.vz);
    if (rem <= 0) p.vx = p.vz = 0; else if (v * DT > rem) { p.vx *= rem / DT / v; p.vz *= rem / DT / v; }
  } else {
    if (S.env.slip) p.mom = p.gnd && (mx || mz) && !inc ? Math.min(1, (p.mom || 0) + DT * 0.8) : Math.max(0, (p.mom || 0) - DT * 1.5); // v0.51 눈마을: 계속 걸으면 점점 빨라진다(최대 20%)
    const k = (reset ? 1.6 : 1) * (s.float > 0 ? 0.3 : 1) * (aimAir ? 1.3 : 1);
    const acc = (p.gnd ? (ice ? 620 : (inc ? 1700 : (S.env.slip ? (mx || mz ? 950 : 560) : S.env.wet ? 3000 : 4600))) : (inc ? 0 : 2200)) * DT;
    p.vx += clamp(mx * spd * k - p.vx, -acc, acc); p.vz += clamp(mz * spd * k - p.vz, -acc, acc);
  }
  const edge = inp & ~p.prev; p.prev = inp; if (edge & K.A) p.aT = S.time;
  if (p.srvA > 0) { if (!(S.phase === 'serve' && S.server === p.i && S.ball.held)) p.srvA = 0; else if (inp & K.A) { p.srvA += DT; if (p.srvA > 0.7) { const t2 = p.srvA; p.srvA = 0; doServe(S, p, false, inp, 0, t2 >= 0.22); } } else { const t2 = p.srvA; p.srvA = 0; doServe(S, p, false, inp, 0, t2 >= 0.22); } }
  if (p.item && S.phase === 'rally' && !p.ko && (p.bot ? botItem(S, p) : (edge & K.I))) useItem(S, p); // v0.51 F로 아이템 사용
  if (supLocked(p)) p.gauge = 0;
  if (S.thornF && S.thornF.team === p.team && p.gnd && !p.ko && !(s.stun > 0) && !(s.thcd > 0)) for (const q of S.thornF.pts) if (Math.hypot(p.x - q[0], (p.z - q[1]) * 1.3) < 34 * XS) { s.stun = 0.45; s.thcd = 1.3; hurt(S, p, 3); ev(S, 'txt', p.x, p.y - 140, p.z, '따끔!', 2); break; } // v0.45 바닥 가시를 밟으면 잠깐 멈춤
  if (!p.bot && !reset && s.puppet <= 0 && ((serving && S.ball.held) || (S.phase === 'rally' && !p.gnd))) { // v0.40 조준 칸: 서브·점프 중 방향키를 한 번 누를 때마다 목표가 한 칸씩 옮겨지고, 손을 떼도 유지된다
    const F = fdir(p) > 0 ? K.R : K.L, Bk = F === K.R ? K.L : K.R;
    if (!p.aimOn) { p.aimOn = true; p.aimX = inp & F ? 1 : inp & Bk ? -1 : 0; p.aimZ = inp & K.U ? -1 : inp & K.D ? 1 : 0; p.aimSx = 350; p.aimSz = p.aimSz0 = p.z; }
    else if (!serving) { if (edge & F) p.aimX = Math.min(1, p.aimX + 1); if (edge & Bk) p.aimX = Math.max(-1, p.aimX - 1); if (edge & K.U) p.aimZ = Math.max(-1, p.aimZ - 1); if (edge & K.D) p.aimZ = Math.min(1, p.aimZ + 1); }
    if (serving && p.aimOn) { /* v1.36 서브 조준: 칸으로 정하지 않고 방향키를 누르고 있는 동안 떨어질 곳이 부드럽게 움직인다(상대 코트 어디든) */ if (inp & F) p.aimSx += 330 * DT; if (inp & Bk) p.aimSx -= 330 * DT; if (inp & K.U) p.aimSz -= ZD * 0.85 * DT; if (inp & K.D) p.aimSz += ZD * 0.85 * DT; p.aimSx = clamp(p.aimSx, 110, 600); p.aimSz = clamp(p.aimSz, ZD * 0.08, ZD * 0.92); }
  } else p.aimOn = false;
  { const b = S.ball; // v0.42 3단 콤보 찬스(v0.44: 리시브·토스 둘 다 나이스일 때만): 리시브→토스 공을 사람이 점프해서 노리면 1/3 속도로 약 1.5초(치는 순간·착지하면 끝)
    if (!p.bot && S.phase === 'rally' && !p.gnd && !S.slowCmb && S.slowSer !== b.serial && !b.held && !b.cap && !b.sup && b.lastTeam === p.team && b.chain >= 2 && b.nice >= 2 && (p.act === 'charge' || p.jumpHold) && sideOf(b.x) === p.team && Math.abs(b.x - p.x) < 320 * XS && !S.tut) {
      S.slowSer = b.serial; S.slowCmb = true; S.slowP = p.i; S.slowT = Math.max(S.slowT, 1.5); ev(S, 'txt', p.x, p.y - 175, p.z, '3단 콤보 찬스!', 1, 1);
    }
    if (S.slowCmb && S.slowP === p.i && p.gnd) { S.slowCmb = false; S.slowT = 0; }
  }
  const noCtl = inc || reset || s.wrap > 0 || s.puppet > 0;
  let jumped = false;
  if (!inc && !reset && p.gnd && p.act !== 'dive' && s.float <= 0 && !serving) {
    if (s.wrap > 0) { if (mx || mz || (edge & K.S)) { p.vy = -290; p.gnd = false; } }
    else if ((edge & K.S) && p.act !== 'charge') { p.vy = -jumpV(p); p.gnd = false; jumped = true; p.jumpAt = S.time; tire(p, 1.5); p.jumpHold = !p.bot; ev(S, 'jump', p.x, GY, p.z); }
  }
  if (s.hop > 0 && p.gnd) { p.vy = -400; p.gnd = false; p.vx = rnd(-120, 120); p.vz = rnd(-90, 90); }
  if (s.float > 0) { // 무중력: 둥실 떠오른다
    p.gnd = false;
    const want = p.y > GY - 235 ? -190 : 34 * Math.sin(S.time * 5 + p.i * 2);
    p.vy += (want - p.vy) * 0.12;
  } else if (!p.gnd) p.vy += pGrav(S, p) * DT;
  const px0 = p.x;
  p.y += p.vy * DT; p.x += p.vx * DT; p.z += p.vz * DT;
  if (p.y >= GY) {
    if (!p.gnd && s.down > 0 && p.bounce > 0 && p.vy > 260) { // 통! 하고 한 번 튕긴다
      p.bounce--; p.y = GY - 1;
      if (p.sky) { p.sky = false; p.vy = -520; ev(S, 'crash', p.x, GY, p.z, p.i); }
      else { p.vy = -p.vy * 0.42; p.vx *= 0.6; p.vz *= 0.6; ev(S, 'land', p.x, GY, p.z); }
    } else if (!p.gnd) {
      p.gnd = true; p.sky = false; if (p.vy > 500) ev(S, 'land', p.x, GY, p.z); if (chOf(p).id === 'dalgareum') p.st.moon = 0.7; /* v0.50 저중력: 착지 뒤 0.7초 빨라짐 */
      if (p.act === 'spike' || p.act === 'block' || p.act === 'super' || p.act === 'charge' || p.act === 'bump') { p.act = 'idle'; p.chg = 0; }
      if (p.fell) { p.fell = false; p.st.stun = Math.max(p.st.stun, 0.55 * cool(p)); hurt(S, p, 8); ev(S, 'bonk', p.x, p.y - 30, p.z, '쿵! 엉덩방아', 3); }
    }
    p.y = GY; p.vy = 0;
  }
  if (wasFloat && s.float <= 0 && !p.gnd) p.fell = true;
  const m = 24 * psc(p);
  const slap = !p.gnd && s.down > 0 && Math.abs(p.vx) > 200 && p.y > NETTOP - 20 ? -0.4 * p.vx : 0, x0 = p.x;
  const out = 85 * XS; // 서브하는 선수만 끝선 뒤로 나갈 수 있다. 밖에 있던 선수는 안쪽으로만 움직인다
  const NX = NETX + (S.netLive ? S.netLive.dx || 0 : 0); // v1.36 멍베크 네트가 움직이면 선수도 밀려서 자기 코트에 남는다
  if (p.team === 0) { const lo = serving ? -out : Math.min(m, px0); if (p.x < lo) { p.x = lo; p.vx = 0; } if (p.x > NX - NETW / 2 - m) { p.x = NX - NETW / 2 - m; p.vx = Math.min(0, p.vx); } }
  else { const hi = serving ? CW + out : Math.max(CW - m, px0); if (p.x > hi) { p.x = hi; p.vx = 0; } if (p.x < NX + NETW / 2 + m) { p.x = NX + NETW / 2 + m; p.vx = Math.max(0, p.vx); } }
  if (slap && p.x !== x0) { p.vx = slap; if (Math.abs(p.x - NETX) < 80 * XS) ev(S, 'bonk', p.x, p.y - 60, p.z, '네트에 찰싹!', 3); }
  if (p.z < 14) { p.z = 14; p.vz = 0; } if (p.z > ZD - 14) { p.z = ZD - 14; p.vz = 0; }
  if (p.gnd && !inc && Math.hypot(p.vx, p.vz) > 90) for (const q of S.peels) if (q.t > 0 && Math.hypot(q.x - p.x, q.z - p.z) < 30) {
    q.t = 0; p.st.down = 1.15 * gutMul(p); const v = Math.hypot(p.vx, p.vz); p.vx = p.vx / v * 420; p.vz = p.vz / v * 420; p.vy = -330; p.gnd = false; p.act = 'idle'; p.chg = 0; p.stats.fall++; hurt(S, p, 10); ev(S, 'slip', p.x, GY, p.z, '미끄덩~', 3);
  }
  if (c.id === 'mandu' && p.gnd && Math.hypot(p.vx, p.vz) < 12 && S.phase === 'rally' && !inc) addGauge(p, 7 * DT);
  p.inReach = ballNear(S, p, 1) ? p.inReach + DT : 0;
  // ----- 액션 -----
  if (noCtl && p.act === 'charge') { p.act = 'idle'; p.chg = 0; }
  const canAct = !noCtl && !jumped && (p.act === 'idle' || p.act === 'charge' || (p.act !== 'dive' && p.actT > 0.2));
  if (canAct && (S.phase === 'rally' || serving)) {
    const pk = S.ball.lastTeam >= 0 && S.ball.lastTeam !== p.team ? 1.45 - 0.75 * (S.ball.prs || 0) : 1; // 약한 공은 나이스 타이밍이 넉넉, 강한 공은 짧다
    const pr2 = p.bot ? Math.random() : p.inReach / (ck.perf * pk || 1), pf = p.bot ? pr2 < aiDf(S).perf * pk : pr2 <= 1; p.pfK = p.bot ? pr2 / (aiDf(S).perf * pk || 1) : pr2; // pfK: 나이스 창 안에서 얼마나 일찍 눌렀나(0~1)
    const b = S.ball;
    let press = edge;
    if (p.bufA > 0) { press |= K.A; p.bufA = 0; }
    if (p.jumpHold) { if (!(inp & K.S) || p.gnd) p.jumpHold = false; else if (p.vy > -jumpV(p) * 0.8) { p.jumpHold = false; if (p.act === 'idle') press |= K.S; } } // S를 누른 채 뛰면 그대로 힘을 모은다
    const mate = p.gnd && !serving && S.phase === 'rally' && !ballNear(S, p, 1.6) ? S.players.find(q => q !== p && q.team === p.team && (q.st.down > 0.3 || q.ko) && Math.hypot(q.x - p.x, q.z - p.z) < 80 * XS) : null;
    if (mate && ((press & K.A) || (p.bot && (p.revCd = (p.revCd || 0) - DT) <= 0))) { mate.st.down = 0; mate.st.flat = 0; if (mate.ko) { mate.ko = false; mate.hp = Math.max(mate.hp, 30); } mate.hp = Math.min(100, mate.hp + 10); p.revCd = 1.5; ev(S, 'txt', mate.x, mate.y - 130, mate.z, '일으켜!', 1); press &= ~K.A; } // v0.55 쓰러진 팀원 옆에서 A
    if ((edge & K.X) && p.gauge >= 100 && !serving) trySuper(S, p);
    else if (press & K.A) {
      if (serving) { if (!p.srvA) p.srvA = 0.001; } // v0.55 A를 짧게 = 언더, 길게(0.22초+) = 플로터
      else if (p.gnd && (mx || mz) && !ballNear(S, p, 1.25)) {
        const v = Math.hypot(mx, mz), maxD = DIVE_LEN * roleK(p, 'dive') * (c.id === 'sene' ? 1.45 : 1) * (S.env.slip || S.ice[p.team] > 0 ? 1.3 : 1);
        tire(p, 2); p.act = 'dive'; p.actT = 0; p.hitDone = false; p.diveX = mx / v; p.diveZ = mz / v; p.diveX0 = p.x; p.diveZ0 = p.z; p.diveLen = maxD; p.chg = 0;
        const L = S.pred && S.pred.land; // 쉬움·보통: 공이 떨어질 곳으로 저절로 향하고, 그 자리를 지나치지 않는다
        if (!p.bot && ck.assist > 0 && L && !b.held && !b.cap && sideOf(L.x) === p.team) {
          const dx = L.x - p.x, dz = L.z - p.z, dd = Math.hypot(dx, dz);
          if (dd > 1) { const ax = p.diveX * (1 - DIV_K) + dx / dd * DIV_K, az = p.diveZ * (1 - DIV_K) + dz / dd * DIV_K, al = Math.hypot(ax, az) || 1; p.diveX = ax / al; p.diveZ = az / al; p.diveLen = Math.min(maxD, Math.max(0, dd - 30)); } // v1.22 누른 방향과 반반
        }
        hurt(S, p, 3); ev(S, 'dive', p.x, GY, p.z);
      }
      else { p.act = 'bump'; p.actT = 0; p.hitDone = false; p.perfect = pf; p.chg = 0; }
    } else if ((press & K.S) && p.act !== 'charge' && (serving || !p.gnd)) {
      const blk = !serving && Math.abs(p.x - NETX) < 135 * XS && !b.held && !b.cap && ((b.lastTeam >= 0 && b.lastTeam !== p.team && sideOf(b.x) !== p.team) || (S.boss && S.boss.hold && p.team === 0)); // v1.37 보스가 공을 들고 있을 때도 블로킹(카운터)할 수 있게
      if (blk) { p.act = 'block'; p.actT = 0; p.hitDone = false; }
      else { p.act = 'charge'; p.actT = 0; p.chg = 0; p.chgHold = 0; }
    }
  }
  else if (!noCtl && !p.bot && ck.buf > 0 && (edge & K.A) && (p.act === 'bump' || p.act === 'spike')) p.bufA = ck.buf; // 조금 일찍 눌러도 받아 준다
  if (p.bufA > 0) p.bufA -= DT;
  if (p.act === 'charge') { // 파워게이지: 누르고 있으면 차고, 떼면 때린다
    let hold = inp & K.S;
    if (hold && ck.auto && !serving && !p.bot && !noTouch(S, p)) { // 쉬움: 공이 닿을 거리에 오면 알아서 때린다
      const b = S.ball, sc = psc(p), ds = b.held || b.cap ? 9999 : Math.hypot(b.x - p.x - fdir(p) * 16 * sc, b.y - p.y + 80 * sc, (b.z - p.z) * ck.zk);
      if (ds < 94 * sc * ck.reach && !(b.lastTeam === p.team && b.teamCd > 0) && (p.chg >= 0.5 || ds > p.sDist)) { hold = 0; p.chg = Math.min(p.chg, 0.5); } // 자동으로 나간 스파이크는 풀파워·콤보가 되지 않는다
      p.sDist = ds;
    }
    if (hold) {
      if (p.chg < 1) { p.chg = Math.min(1, p.chg + DT / (serving ? 0.7 : p.bot ? 0.42 : SPK_CHG)); if (p.chg >= 1) ev(S, 'full', p.x, p.y - 70, p.z, p.i); }
      else { p.chgHold += DT; if (p.chgHold > (serving || p.bot ? 0.9 : SPK_HOLD)) { p.chg = 0.3; p.chgHold = 0; ev(S, 'txt', p.x, p.y - 150, p.z, '힘 빠짐…', 2); } }
    } else if (serving) doServe(S, p, true, inp, p.chg);
    else { p.pw = 0.76 + 0.52 * p.chg; p.act = 'spike'; p.actT = 0; p.hitDone = false; }
  } else if (p.act !== 'idle') {
    p.actT += DT;
    const dur = p.act === 'bump' ? 0.32 : p.act === 'spike' ? 0.36 : p.act === 'super' ? 0.55 : p.act === 'dive' ? (S.env.sand ? 0.62 : 0.82) : 9;
    if (p.actT >= dur) { if (p.act === 'spike' && !p.hitDone && !S.ball.held && !S.ball.cap && S.phase === 'rally' && d3(S.ball.x, S.ball.y, S.ball.z, p.x, p.y - 80, p.z) < 230) ev(S, 'txt', p.x, p.y - 150, p.z, '헛스윙~', 0); p.act = 'idle'; p.actT = 0; }
  }
}

function contacts(S) {
  const b = S.ball;
  if (b.held || b.cap || S.phase !== 'rally') return;
  if (b.unrecv && b.lastTeam === 1) return; // v1.28 보스 암흑 대포는 못 받는다
  const np = S.players.length;
  { const h = S.bh || (S.bh = []); S.bhI = ((S.bhI | 0) + 1) & 15; h[S.bhI] = { x: b.x, y: b.y, z: b.z, ser: b.serial }; } // v0.61 최근 16틱의 공 위치(지연이 있는 사람의 타격 판정에 쓴다)
  for (let oi = 0; oi < np; oi++) {
    const p = S.players[S.tick & 1 ? oi : np - 1 - oi]; if (S.phase !== 'rally' || b.cap || (S.netLive && S.netLive.mode && !S.netLive.done)) return; /* v0.56 네트가 움직이는 중엔 결과가 정해진 공 */
    if (p.hitCd > 0 || p.gone) continue;
    if (b.lastTeam === p.team && b.teamCd > 0) continue;
    const ck = ctl(S, p), s = psc(p), f = fdir(p), c = chOf(p), rm = (c.id === 'jiae' ? 1.2 : c.id === 'snurse' ? 1.05 : 1) * roleK(p, 'reach') * ck.reach * prsK(S, p) * (S.rallyHits === 0 && b.lastTeam !== p.team ? (b.ultra ? 1 : 1.12) : 1) * (p.ck || 1) * (!p.bot && b.lastTeam >= 0 && b.lastTeam !== p.team ? RCV_K : 1);
    const lg = !p.bot && p.lagT > 0 ? Math.min(12, p.lagT | 0) : 0, hb = lg ? S.bh[(S.bhI - lg) & 15] : null, vb = hb && hb.ser === b.serial ? hb : b; // v0.61 그 사람 화면에 보이던 공 위치(최대 0.2초 전, 그 사이 공을 누가 쳤으면 지금 위치)
    const dist = (x, y, z) => Math.hypot(vb.x - x, vb.y - y, (vb.z - z) * ck.zk), bodyD = d3(b.x, b.y, b.z, p.x, p.y - 46 * s, p.z);
    if (!busy(p)) {
      const dbl = noTouch(S, p), no = () => { p.hitDone = true; if (p.dblS !== b.serial) { p.dblS = b.serial; ev(S, 'txt', p.x, p.y - 150, p.z, '연속 터치!', 0); } };
      if (p.act === 'bump' && p.actT <= 0.24 && !p.hitDone && dist(p.x + f * 10 * s, p.y - 56 * s, p.z) < 96 * s * rm) { if (dbl) no(); else hitBump(S, p, false); continue; }
      if (p.act === 'spike' && p.actT <= 0.22 && !p.hitDone && dist(p.x + f * 16 * s, p.y - 80 * s, p.z) < 100 * s * ck.reach) { if (dbl) no(); else if (!p.gnd && b.lastTeam >= 0 && b.lastTeam !== p.team && Math.random() < DIRECT_MISS) { p.hitDone = true; ev(S, 'txt', p.x, p.y - 150, p.z, '헛스윙~', 0); } else hitSpike(S, p); continue; }
      if (p.act === 'super' && p.actT <= 0.42 && !p.hitDone && dist(p.x + f * 12 * s, p.y - 72 * s, p.z) < 128 * s) { if (dbl) no(); else hitSuper(S, p); continue; }
      if (p.act === 'block' && b.lastTeam !== p.team && dist(p.x + f * 22 * s, p.y - 112 * s, p.z) < (c.id === 'goseum' ? 56 : 32) * s * roleK(p, 'blk') + BR) { hitBlock(S, p); continue; }
      if (p.act === 'dive' && p.actT < 0.4 && !p.hitDone && dist(p.x + p.diveX * 30, p.y - 26, p.z + p.diveZ * 30) < 74 * s * rm) { if (dbl) no(); else hitBump(S, p, true); continue; }
    }
    // 몸에 맞기: 상대가 친 공만(우리 팀 공은 통과)
    if (b.lastTeam !== p.team && bodyD < 34 * s * (c.id === 'chiwa' ? 0.72 : 1) + BR) { // 서브를 A로 받으려다 타이밍만 어긋나 몸에 맞으면(쉬움·보통의 사람) 넘어지지 않고 몸으로 받아 낸다(공은 조금 엉뚱하게 뜬다)
      if (S.rallyHits === 0 && !p.bot && ck.assist > 0 && p.gnd && !busy(p) && !b.sup && !b.out && p.act !== 'dive' && ((p.inp & K.A) || S.time - (p.aT || -9) < 0.6)) hitBump(S, p, 'body');
      else hitBody(S, p);
    }
  }
}

/* ---------- 아이템 ---------- */
function useItem(S, p) { // 가진 아이템을 쓴다
  const type = p.item; p.item = null; if (!type) return;
  const team = p.team, mine = S.players.filter(q => q.team === team), opp = S.players.filter(q => q.team !== team), nm = ITEMS.find(i => i.id === type).name;
  ev(S, 'item', p.x, p.y - 80, p.z, type, team); ev(S, 'txt', p.x, p.y - 150, p.z, nm + '!', team === 0 ? 4 : 5);
  if (type === 'cheese') addGauge(p, 50 / ((p.gk || 1) * GAUGE_K));
  else if (type === 'big') { p.big = 8; p.mini = 0; }
  else if (type === 'fast') for (const q of mine) q.fast = 6;
  else if (type === 'mini') for (const q of opp) { q.mini = 6; q.big = 0; }
  else if (type === 'banana') for (let i = 0; i < 4; i++) S.peels.push({ x: oppD(team, rnd(70, 560)), z: rnd(30, ZD - 30), t: 14 });
  else if (type === 'balloon') S.ball.float = 4;
  else if (type === 'heal') for (const q of mine) { q.hp = Math.min(100, q.hp + 60); if (q.ko) q.ko = false; q.st.down = 0; q.st.flat = 0; }
}
function spawnItem(S, side) { // 코트 바닥에 아이템이 생긴다(코트마다 한 개까지)
  const T = side === 0 || side === 1 ? side : Math.random() < 0.5 ? 0 : 1; if (S.items.some(i => sideOf(i.x) === T)) return;
  const it = { id: S.itemId++, type: ITEMS[Math.floor(Math.random() * ITEMS.length)].id, x: netD(T, rnd(90, 560)), y: GY - 46, z: rnd(40, ZD - 40), t: 14 };
  S.items.push(it); ev(S, 'spawn', it.x, it.y, it.z);
}
function stepItems(S) {
  const b = S.ball;
  for (const q of S.peels) q.t -= DT; S.peels = S.peels.filter(q => q.t > 0);
  if (b.float > 0) b.float -= DT;
  if (!S.itemsOn || S.phase !== 'rally') return;
  for (const T of [0, 1]) if (!(S.boss && T === 1) && (S.itemT2[T] -= DT) <= 0) { S.itemT2[T] = rnd(35, 50) * (S.env.fest ? 0.7 : 1); spawnItem(S, T); } // v0.52 코트마다 20~30초에 하나 → v1.26 35~50초(첫 아이템 20~35초)
  for (const it of S.items) {
    it.t -= DT;
    for (const p of S.players) if (it.t > 0 && !p.ko && GY - p.y < 150 && Math.hypot(p.x - it.x, (p.z - it.z) * 1.2) < 46 * psc(p)) { // 밟으면 줍는다(하나만 가질 수 있다)
      if (p.item && p.item !== it.type) ev(S, 'txt', p.x, p.y - 190, p.z, ITEMS.find(i => i.id === p.item).name + ' 버림', 0); // 하나만 가질 수 있다: 새 걸 주우면 예전 건 사라진다
      p.item = it.type; it.t = 0; p.itT = rnd(0.6, 2.2); ev(S, 'pick', it.x, it.y, it.z, it.type, p.i); ev(S, 'txt', p.x, p.y - 150, p.z, ITEMS.find(i => i.id === it.type).name + ' 획득!', p.team === 0 ? 4 : 5);
    }
  }
  S.items = S.items.filter(it => it.t > 0);
}
function botItem(S, p) { // PC가 아이템을 쓸 때
  if ((p.itT -= DT) > 0) return false;
  const b = S.ball, t = p.item, mine = S.players.filter(q => q.team === p.team);
  if (t === 'heal') return mine.some(q => q.ko || q.hp < 50);
  if (t === 'balloon') return b.lastTeam !== p.team && !b.held && sideOf(b.x) !== p.team && b.power;
  if (t === 'big') return b.lastTeam === p.team || sideOf(b.x) === p.team;
  return true;
}

/* ---------- 봇 AI ---------- */
function intercept(S, p, pr, mode) {
  const s = psc(p), pts = pr.pts;
  if (!pts.length) return null;
  if (mode === 'spike') {
    const hy = GY - (jumpH(S, p) * 0.8 + 86 * s);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (q.vy > 0 && q.y >= hy) {
        if (q.y > hy + 34 || sideOf(q.x) !== p.team || Math.abs(q.x - NETX) < 34) return null;
        return { x: q.x, y: q.y, z: q.z, t: q.t, mode };
      }
    }
    return null;
  }
  const hy = GY - 112 * s;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if ((q.vy > 0 && q.y >= hy) || i === pts.length - 1) {
      if (sideOf(q.x) !== p.team) return null;
      return { x: q.x, y: q.y, z: q.z, t: q.t, mode: 'bump' };
    }
  }
  return null;
}
function aiTeam(S, team, pr) {
  const b = S.ball, D = aiDf(S), Tm = S.teamAI[team];
  Tm.bz = Tm.bz == null ? b.z : Tm.bz + (b.z - Tm.bz) * Math.min(1, DT * 3.5); // 블로커가 보는 공 깊이(약 0.3초 늦게 따라감)
  const mine = S.players.filter(p => p.team === team), opp = S.players.filter(p => p.team !== team);
  const n = b.lastTeam === team ? b.touches : 0;
  if (Tm.serial !== b.serial) {
    const soft = !S.boss && b.lastTeam !== team && b.lastTeam >= 0 && !b.power && !b.sup, ek = soft ? 0.5 : 1; // v1.36 상대가 넘긴 약한 공(토스·살짝 넘긴 공)은 PC가 더 잘 받는다: 위치 오차 절반, 반응 30% 빠르게
    Tm.serial = b.serial; Tm.chaser = -1; Tm.roll = Math.random(); Tm.roll2 = Math.random(); Tm.err = rnd(-D.err, D.err) * ek; Tm.errZ = rnd(-D.err, D.err) * ek;
    Tm.miss = b.power && Math.random() < Math.min(0.9, D.miss * (1 + heat(S)) * (S.boss ? 1 : 1.45)); // v1.36 강스파이크는 PC가 덜 받는다(타이밍 놓침 1.45배)
    Tm.wake = S.time + (b.lastTeam === team ? 0.04 : D.react * rnd(0.7, 1.3) * (soft ? 0.7 : 1)); Tm.tac = Math.random(); Tm.tacZ = Math.random();
  }
  const able = p => !(busy(p) || p.st.wrap > 0 || p.st.puppet > 0 || p.st.float > 0 || p.act === 'dive');
  const homing = b.home > 0 && b.supTeam !== team;
  const dxz = (p, x, z) => Math.hypot(p.x - x, p.z - z);
  let best = null, bestCost = 1e9, bestIt = null;
  if (S.phase === 'rally' && !homing && n < 3) for (const p of mine) {
    if (!able(p) || noTouch(S, p)) continue;
    let it = null;
    if (n >= 2 || (n === 1 && Tm.roll < D.two)) it = intercept(S, p, pr, 'spike');
    if (!it) it = intercept(S, p, pr, 'bump');
    if (!it) continue;
    const dd = dxz(p, it.x, it.z);
    let cost = dd / pSpeed(S, p) - it.t;
    if (cost < -0.5) cost = -0.5 + dd / 2000;
    if (p.i === b.lastP && S.n > 1) cost += 0.18;
    if (p.i === Tm.chaser) cost -= 0.12;
    if (S.n > 1) { const rl = roleOf(p); if (n === 1 && rl === 'setter') cost -= 0.2; else if (n === 0 && rl === 'libero') cost -= 0.12; else if (it.mode === 'spike' && rl === 'spiker') cost -= 0.15; else if (it.mode === 'spike' && rl === 'libero') cost += 0.3; } // v0.98 PC도 역할대로: 첫 공은 리베로, 두 번째는 세터, 공격은 스파이커
    if (!p.bot) cost -= n === 0 ? (dd < 250 ? 0.4 : 0) : it.mode === 'spike' ? 0.3 : 0; // 사람 가까이 오는 첫 공과 마지막 공격은 사람에게 맡긴다
    if (cost < bestCost) { bestCost = cost; best = p; bestIt = it; }
  }
  Tm.chaser = best ? best.i : -1;
  const awake = S.time >= Tm.wake;
  const oppAttack = b.lastTeam === 1 - team && !b.held && !b.cap && sideOf(b.x) !== team;
  let front = null; for (const p of mine) if (p.bot && able(p) && (!front || Math.abs(p.x - NETX) < Math.abs(front.x - NETX)) && p !== best) front = p;
  let prey = null; if (homing) for (const p of mine) if (!p.ko && (!prey || d3(p.x, p.y, p.z, b.x, b.y, b.z) < d3(prey.x, prey.y, prey.z, b.x, b.y, b.z))) prey = p;
  for (const p of mine) {
    if (!p.bot) continue;
    let inp = 0; const f = fdir(p), s = psc(p), c = chOf(p);
    const go = (tx, tz, dz) => { if (p.x < tx - dz) inp |= K.R; else if (p.x > tx + dz) inp |= K.L; if (p.z < tz - dz) inp |= K.D; else if (p.z > tz + dz) inp |= K.U; };
    const press = k => { if (!(p.prev & k)) inp |= k; };
    const fwdK = f > 0 ? K.R : K.L, backK = f > 0 ? K.L : K.R, h = home(S, p);
    if (S.phase === 'serve') {
      if (S.server === p.i) {
        if (p.ai.svSerial !== b.serial) { p.ai.svSerial = b.serial; p.ai.sv = { flt: Math.random() < 0.4, pow: Math.random() < 0.6, hold: rnd(0.25, 0.7) * (0.4 + D.chg * 0.6), dir: Math.random(), dz: Math.random() }; }
        const sv = p.ai.sv;
        if (S.phaseT > p.ai.serveAt) {
          if (sv.dir < 0.3) inp |= fwdK; else if (sv.dir < 0.55) inp |= backK;
          if (sv.dz < 0.33) inp |= K.U; else if (sv.dz < 0.66) inp |= K.D;
          if (!sv.pow) { if (!sv.flt || S.phaseT < p.ai.serveAt + 0.32) inp |= K.A; } else if (S.phaseT < p.ai.serveAt + sv.hold) inp |= K.S;
        }
      } else go(h[0], h[1], 12);
    } else if (S.phase === 'rally') {
      if (c.type === 'instant' && p.gauge >= 100 && able(p) && Tm.roll2 < D.sup && pr.land) {
        if (c.sup === 'ufo') { if (sideOf(pr.land.x) === team && pr.land.t < 0.75 && !b.cap) inp |= K.X; }
        else if (c.sup === 'net') { if (b.lastTeam !== team && b.lastTeam >= 0 && sideOf(b.x) !== team && b.touches >= 1 && !S.basin && !S.netLive) inp |= K.X; }
        else if (c.sup === 'basin') { if (!S.basin && b.lastTeam !== team && sideOf(b.x) !== team && S.players.some(q => q.team !== team && !q.gnd && (q.act === 'charge' || q.act === 'spike' || q.jumpHold))) inp |= K.X; } // v0.50 다라이는 상대가 스파이크하려고 뛸 때 // 다라이·네트는 상대가 공격하려 할 때
        else if (c.sup === 'heal') { const oppG = S.players.filter(q => q.team !== team).reduce((m, q) => Math.max(m, q.gauge), 0); if (S.players.some(q => q.team === team && (q.hp < 55 || q.ko || (q !== p && q.gauge < 40))) || p.hp < 70 || oppG >= 60) inp |= K.X; } // v0.50 1:1에서도: 내 체력 70 미만이거나 상대 게이지 60 이상
        else if (b.lastTeam === team && sideOf(pr.land.x) !== team && pr.land.t > 0.25 && pr.land.t < 1.1) inp |= K.X;
      }
      const human = best && !best.bot;
      let chase = awake && best === p;
      if (awake && human && best !== p && able(p)) {
        const it = intercept(S, p, pr, 'bump');
        if (it && it.t < 0.26 && dxz(best, bestIt.x, bestIt.z) > 130 && dxz(p, it.x, it.z) < 240 && !noTouch(S, p)) chase = true; // 사람이 끝내 안 움직이면 막판에 뛰어들어 본다(늦어서 자주 놓친다)
      }
      if (homing) { // 가시공에 쫓기는 중
        if (p === prey) { go(b.x > p.x ? 0 : CW, b.z > p.z ? 0 : ZD, 5); if (ballNear(S, p, 0.9)) { inp &= ~15; inp |= K.A; } }
        else go(h[0], h[1], 14);
      } else if (chase) {
        const it = best === p ? bestIt : intercept(S, p, pr, 'bump');
        if (it && it.mode === 'spike') {
          const tx = it.x - f * 28 * s + Tm.err * 0.5, tz = it.z + Tm.errZ * 0.4;
          go(tx, tz, 10);
          const tj = jumpV(p) / pGrav(S, p) * 0.8;
          const inR = !p.gnd && d3(b.x, b.y, b.z, p.x + f * 16 * s, p.y - 80 * s, p.z) < 100 * s * 0.86;
          if (p.gnd) { if (it.t <= tj + 0.02 && dxz(p, tx, tz) < 55) { inp &= ~K.S; press(K.S); } }
          else if (p.gauge >= 100 && c.type === 'spike' && Tm.roll2 < D.sup && inR && p.act !== 'spike') { inp &= ~15; inp |= K.X; }
          else if (p.act === 'charge') { if (!inR) inp |= K.S; }
          else if (p.act === 'idle' && (inR || (D.chg > 0 && p.vy > -jumpV(p) * (0.2 + D.chg * 0.75)))) press(K.S);
          if (inR || p.act === 'spike') { // 코스 선택
            inp &= ~15;
            let px = Tm.tac < 0.45 ? 0 : Tm.tac < 0.75 ? 1 : 2, pz = Tm.tacZ < 0.4 ? 0 : Tm.tacZ < 0.7 ? 1 : 2;
            if (aiD(S) === 'hard' || aiD(S) === 'hell') {
              let bd = -1;
              for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
                const x = oppD(team, [350, 525, 185][ix]), z = [p.z, ZD * 0.18, ZD * 0.82][iz];
                let m = 1e9; for (const q of opp) if (!busy(q)) m = Math.min(m, Math.hypot(q.x - x, q.z - z));
                if (m > bd) { bd = m; px = ix; pz = iz; }
              }
            }
            if (px === 1) inp |= fwdK; else if (px === 2) inp |= backK;
            if (pz === 1) inp |= K.U; else if (pz === 2) inp |= K.D;
          }
        } else if (it) {
          const tx = it.x - f * 8 + Tm.err, tz = it.z + Tm.errZ * 0.6;
          go(tx, tz, 9);
          const dd = dxz(p, tx, tz);
          if (Tm.miss && n === 0) { /* 타이밍을 놓쳤다 → 몸으로 받게 됨 */ }
          else if (ballNear(S, p, 0.84)) {
            inp &= ~15; inp |= K.A;
            if (b.sup === 'hot' && n < 2) { if (p.gnd) { inp &= ~K.A; press(K.S); } } // 폭탄은 뛰어서 바로 넘긴다
            else if (n === 1) {
              const hm = mine.find(q => !q.bot && q !== p && !busy(q));
              if (hm) { const d = Math.abs(hm.x - NETX); if (d < 125) inp |= fwdK; else if (d > 300) inp |= backK; if (hm.z < p.z - 70) inp |= K.U; else if (hm.z > p.z + 70) inp |= K.D; }
              else { if (Tm.tac < 0.25) inp |= fwdK; else if (Tm.tac > 0.8) inp |= backK; if (Tm.tacZ < 0.2) inp |= K.U; else if (Tm.tacZ > 0.8) inp |= K.D; }
            } else if (n >= 2) { if (Tm.tac < 0.35) inp |= fwdK; else if (Tm.tac > 0.8) inp |= backK; if (Tm.tacZ < 0.33) inp |= K.U; else if (Tm.tacZ > 0.66) inp |= K.D; }
          } else if (p.gnd && it.t < 0.42 && dd > pSpeed(S, p) * it.t + 36 && dd < DIVE_LEN + 40 && b.y > GY - 300 && Tm.roll < D.dive) {
            inp &= ~15; inp |= K.A; if (Math.abs(tx - p.x) > 20) inp |= tx > p.x ? K.R : K.L; if (Math.abs(tz - p.z) > 20) inp |= tz > p.z ? K.D : K.U;
          }
        } else go(h[0], h[1], 14);
      } else {
        let hx = h[0], hz = h[1];
        if (p === front && oppAttack && D.block > 0 && Tm.roll < D.block * (BLK_N[S.n] || 1)) {
          hx = netD(team, 58); hz = (Tm.bz != null ? Tm.bz : b.z) + Tm.errZ * 1.8 + (Tm.roll2 - 0.5) * 60; // 공 깊이를 조금 늦게, 오차를 두고 따라간다(코스를 비틀면 피할 수 있게)
          const atk = opp.find(q => !q.gnd && Math.abs(q.x - NETX) < 260 * XS && d3(b.x, b.y, b.z, q.x, q.y - 80, q.z) < 190);
          go(hx, hz, 12);
          if (atk && p.gnd && dxz(p, hx, hz) < 70) { inp &= ~K.S; press(K.S); }
          if (!p.gnd && p.vy < 200 && p.act === 'idle' && d3(b.x, b.y, b.z, p.x, p.y - 110, p.z) < 300) press(K.S);
        } else {
          if (human && best !== p && bestIt && dxz({ x: hx, z: hz }, bestIt.x, bestIt.z) < 90) hx = bestIt.x - f * 110;
          go(hx, hz, 14);
        }
      }
    }
    if (S.phase === 'rally' && p.gnd && able(p) && p !== best && b.lastTeam === team && sideOf(b.x) === team) { const mt = mine.find(q => q !== p && !q.gnd && q.jumpAt != null && S.time - q.jumpAt < 0.12 && Math.abs(q.x - NETX) < 300 * XS && Math.hypot(q.x - p.x, q.z - p.z) < 240 * XS); // v0.95 동료가 네트 앞에서 뛰면 PC가 가끔 같이 뛴다(합동 스파이크)
      if (mt && p.duoSer !== b.serial) { p.duoSer = b.serial; if (Math.random() < (mt.bot ? 0.05 : 0.4)) press(K.S); } }
    if ((p.prev & K.A) && !(p.srvA > 0)) inp &= ~K.A; if (p.prev & K.X) inp &= ~K.X;
    p.inp = inp;
  }
}

/* ---------- 메인 스텝 ---------- */
function stepUfo(S) {
  const u = S.ufo, b = S.ball; u.t += DT;
  const sm = k => k * k * (3 - 2 * k);
  if (u.st === 0) {
    const k = sm(Math.min(1, u.t / 0.55));
    u.x = u.sx + (b.x - u.sx) * k; u.y = u.sy + (b.y - 64 - u.sy) * k; u.z = u.sz + (b.z - u.sz) * k;
    if (u.t >= 0.55) { u.st = 1; u.t = 0; u.bx = u.x; u.by2 = u.y; u.bz = u.z; }
  } else if (u.st === 1) {
    const tt = Math.min(u.t, u.dur - 0.5), sway = oppD(u.team, 330) + Math.sin(u.ph + tt * u.w) * 232 * XS, swz = ZD / 2 + Math.sin(u.ph2 + tt * u.w2) * ZD * 0.36, ky = sm(Math.min(1, u.t / 0.55));
    u.x = u.bx + (sway - u.bx) * ky; u.y = u.by2 + (175 - u.by2) * ky; u.z = u.bz + (swz - u.bz) * ky;
    b.x = u.x; b.y = u.y + 62; b.z = u.z; b.vx = b.vy = b.vz = 0;
    if (u.t >= u.dur) {
      b.cap = false; b.vy = 1300; b.power = true; b.serial++; b.teamCd = 0;
      if (b.sup !== 'hot') { b.sup = 'ufo'; b.supTeam = u.team; b.supP = u.by; }
      u.st = 2; u.t = 0; ev(S, 'ufodrop', b.x, b.y, b.z, u.team);
      const me = S.players[u.by]; let got = 0;
      for (const q of S.players) if (q.team !== u.team) { const v = Math.min(25, q.gauge); q.gauge -= v; got += v; q.st.sad = 2.2; ev(S, 'coin', q.x, q.y - 60, q.z, u.by); if (v > 0) ev(S, 'txt', q.x, q.y - 150, q.z, '텅장…', 2); }
      if (me) addGauge(me, got);
    }
  } else { u.y -= 520 * DT; u.x += (u.team === 0 ? 1 : -1) * 260 * DT; if (u.t > 1.3) S.ufo = null; }
}
function step(S) {
  useCourt(S.n);
  if (S.freezeT > 0) { S.freezeT -= DT; if (S.cut) { S.cut.t += DT; clashScan(S); } if (S.freezeT <= 0) { const cut = S.cut; S.cut = null; if (cut) endCut(S, cut); } return; }
  if (S.stopT > 0) { S.stopT -= DT; return; }
  { const R = S.ref; if (R) { R.t += DT; if ((R.st === 2 && R.t > 1.4) || (R.st === 1 && R.t > 0.7)) { R.st = R.n > 0 ? 3 : 0; R.t = 0; } } }
  if (S.slowT > 0) { S.slowT -= DT; if (S.slowT <= 0) S.slowCmb = false; S.slowN = (S.slowN + 1) % 3; if (S.slowN) return; }
  S.tick++; S.time += DT; S.phaseT += DT;
  const b = S.ball;
  S.pred = predict(S);
  if (S.phase !== 'over') { aiTeam(S, 0, S.pred); if (!S.boss) aiTeam(S, 1, S.pred); } else for (const p of S.players) if (p.bot) p.inp = 0;
  if (S.boss && S.phase !== 'over') { if (S.phase === 'bossev') bossEvBots(S); else bossBots(S); }
  if (b.out && S.phase === 'rally' && S.pred && S.pred.land && (S.pred.land.x < 0 || S.pred.land.x > CW)) for (const p of S.players) if (p.bot && p.team !== b.lastTeam) p.inp = 0; // PC는 나가는 서브를 건드리지 않고 지켜본다
  for (const p of S.players) stepPlayer(S, p);
  if (S.chal && S.chal.k === 'rally' && S.phase === 'rally') { const sd = sideOf(S.ball.x); if (S.chal.side >= 0 && sd !== S.chal.side) S.chal.cur++; S.chal.side = sd; } // 랠리 횟수(네트를 넘을 때마다)
  for (let i = 0; i < S.players.length; i++) for (let j = i + 1; j < S.players.length; j++) { // v0.55 같은 편끼리 겹치지 않게 살짝 밀어낸다
    const a = S.players[i], q = S.players[j]; if (a.team !== q.team || !a.gnd || !q.gnd || a.act === 'dive' || q.act === 'dive') continue;
    const dx = q.x - a.x, dz = (q.z - a.z) * 1.3, d = Math.hypot(dx, dz), m = 44 * XS; if (d >= m || d < 0.01) continue;
    const push = (m - d) * 0.12; a.x -= dx / d * push; q.x += dx / d * push; a.z -= dz / d * push / 1.3; q.z += dz / d * push / 1.3;
  }
  for (const p of S.players) if (p.st.down > 0 && !p.gnd && !p.bowled && !p.sky && Math.hypot(p.vx, p.vz) > 150 && p.y > GY - 150) // 날아가다 동료와 쾅
    for (const q of S.players) if (q !== p && q.team === p.team && q.gnd && !busy(q) && Math.hypot(q.x - p.x, q.z - p.z) < 58) {
      p.bowled = true; knock(S, q, 0.75, p.vx >= 0 ? 1 : -1); q.vx *= 0.75; q.vy = -330; hurt(S, q, 5); ev(S, 'bonk', q.x, q.y - 60, q.z, '우당탕!', 3); break;
    }
  if (S.phase === 'rally') { if (S.ice[0] > 0) S.ice[0] -= DT; if (S.ice[1] > 0) S.ice[1] -= DT; } // v1.36 이스 빙판도 경기 중에만 시간이 간다
  if (b.teamCd > 0) b.teamCd -= DT;
  if (S.ufo && (S.phase === 'rally' || S.ufo.st === 2)) stepUfo(S);
  if (S.mom) stepMom(S);
  if (S.netLive) stepNetLive(S);
  if (S.phase === 'rally') { if (S.netLive && !S.netLive.mode && (S.netLive.t -= DT) <= 0) S.netLive = null; if (S.basin && (S.basin.t -= DT) <= 0) S.basin = null; }
  stepStage(S);
  if (S.boss) bossStep(S);
  if (S.phase === 'serve') {
    if (S.phaseT > 0.4 && !S.dblChk && !S.boss) { S.dblChk = true; const D = S.dbl; // v0.95 PC 팀: 뒤지고 있고 상대가 거의 이겼을 때 가끔 떠블
      for (const T of [0, 1]) { const ps = S.players.filter(q => q.team === T); if (ps.every(q => q.bot) && !(D && (D.used[T] || D.on >= 0)) && S.score[1 - T] - S.score[T] >= 2 && S.score[1 - T] >= S.target - 3 && Math.random() < 0.35) { askDouble(S, ps[0].i); break; } } }
    const p = S.players[S.server], f = fdir(p);
    if (b.held) { b.x = p.x + f * 30; b.y = p.y - 62; b.z = p.z; b.rot = 0; }
    if (S.phaseT > 6.5 && b.held) doServe(S, p, false, 0, 0);
  } else if (S.phase === 'rally' && S.boss && S.boss.hold) { bossHolding(S); stepItems(S);
  } else if (S.phase === 'rally') {
    if (b.sup === 'hot' && !b.cap) { b.fuse -= DT; if (b.fuse <= 0) explode(S); }
    for (let k = 0; k < 2 && S.phase === 'rally'; k++) {
      if (!b.cap) {
        if (b.home > 0) { // 추적 가시공
          b.home -= DT / 2;
          let q = null; for (const o of S.players) if (o.team !== b.supTeam && !o.ko && (!q || d3(o.x, o.y, o.z, b.x, b.y, b.z) < d3(q.x, q.y, q.z, b.x, b.y, b.z))) q = o;
          if (q) {
            let tx = q.x, ty = q.y - 34 * psc(q), tz = q.z;
            if (sideOf(b.x) === b.supTeam && b.y > NETTOP - 80) { tx = oppD(b.supTeam, 40); ty = NETTOP - 120; }
            const d = d3(tx, ty, tz, b.x, b.y, b.z) || 1, k2 = Math.min(1, 7 * DT / 2);
            b.vx += ((tx - b.x) / d * 600 - b.vx) * k2; b.vy += ((ty - b.y) / d * 600 - b.vy) * k2; b.vz += ((tz - b.z) / d * 600 - b.vz) * k2;
          }
          b.nog = true; ballStep(S, b, DT / 2, true); b.nog = false;
          if (b.home <= 0) ev(S, 'txt', b.x, b.y - 40, b.z, '(가시공이 지쳤다)', 0);
        } else { const L = S.netLive, nx0 = NETX + (L ? L.dx : 0), px0 = b.x; ballStep(S, b, DT / 2, true); const nx1 = NETX + (L ? L.dx : 0); if ((px0 < nx0) !== (b.x < nx1) && netCross(S, px0 < nx0 ? 0 : 1)) continue; }
        b.rot += b.vx * DT / 2 / BR;
        if (b.prsSer !== b.serial) { b.prsSer = b.serial; b.prs = ballPrs(b); }
        if (b.srv && sideOf(b.x) !== b.lastTeam) b.srv = false; // 서브가 네트를 넘어감
        if (b.ceilFault) { b.ceilFault = false; b.srv = false; ev(S, 'txt', NETX, 250, ZD / 2, '서브 실패! (천장)', 3, 1); point(S, 1 - b.lastTeam, -1); break; }
        if (b.y + BR >= GY) {
          b.y = GY - BR;
          if ((b.out || S.env.windy) && (b.x < 0 || b.x > CW) && !(S.netLive && S.netLive.mode && !S.netLive.done)) { // v0.51 아웃은 실제로 떨어진 자리로 판정(바람에 밀려 들어오면 인, 밀려 나가면 아웃)
            const R = S.ref, od = b.x < 0 ? -b.x : b.x - CW, lt = b.lastTeam;
            if (R && R.n > 0 && R.team === 1 - lt && od < 90 * XS) { // v0.95 심판 뒤끝: 원한 있는 팀에 불리하게 '인'
              ev(S, 'ground', b.x, GY, b.z, 0, 0); ev(S, 'txt', clamp(b.x, 200, CW - 200), 260, b.z, '인!? (심판 뒤끝)', 3, 1); ev(S, 'txt', NETX, GY - 360, -70, '흥!', 3);
              point(S, lt, -1); b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.6; b.vz *= 0.6; break;
            }
            ev(S, 'ground', b.x, GY, b.z, 0, 0); ev(S, 'txt', clamp(b.x, 200, CW - 200), 260, b.z, b.outK === 'serve' ? '서브 아웃!' : '아웃!', 2, 1);
            point(S, 1 - lt, -1); b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.6; b.vz *= 0.6;
            if (R && R.n <= 0 && !S.tut && b.z < ZD * 0.5 && Math.random() < (S.refP != null ? S.refP : 0.05)) { R.team = lt; R.n = 2; R.st = 2; R.t = 0; ev(S, 'ref', b.x, GY, b.z, lt); ev(S, 'txt', NETX, GY - 360, -70, '아야!! 두고 보자…', 3); } // v0.95 심판 쪽 아웃 공 약 5%가 심판 얼굴에
            break;
          }
          const NL = S.netLive && S.netLive.mode && !S.netLive.done ? S.netLive : null, side = NL ? (b.x < NETX + NL.dx ? 0 : 1) : sideOf(b.x), scorer = NL ? (side !== NL.team ? NL.by : -1) : b.lastTeam === 1 - side ? b.lastP : -1; if (NL) { NL.done = true; ev(S, 'txt', NETX + NL.dx, NETTOP - 130, ZD / 2, '네트 대이동 득점!!', 1, 1); }
          { const R = S.ref; if (!NL && R && R.n > 0 && b.lastTeam === R.team && side !== R.team && Math.min(b.x, CW - b.x) < NETX * 0.45 && Math.random() < 0.6) { // v0.95 심판 뒤끝: 원한 있는 팀이 끝선 가까이 넣은 공은 '아웃'
            ev(S, 'ground', b.x, GY, b.z, 0, 0); ev(S, 'txt', clamp(b.x, 200, CW - 200), 260, b.z, '아웃!? (심판 뒤끝)', 3, 1); ev(S, 'txt', NETX, GY - 360, -70, '흥!', 3);
            point(S, 1 - R.team, -1); b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.6; b.vz *= 0.6; b.home = 0; break; } }
          ev(S, 'ground', b.x, GY, b.z, b.sup || 0, b.power || b.sup ? 1 : 0); if (b.power || b.sup) S.stopT = 0.07;
          if (scorer >= 0 && b.power && roleOf(S.players[scorer]) === 'spiker') addGauge(S.players[scorer], 10); // v0.95 스파이커 득점 보너스
          if (S.rallyHits === 0 && scorer >= 0) { ev(S, 'txt', NETX, 250, ZD / 2, '서브 에이스!', 1, 1); addGauge(S.players[scorer], 12); }
          const hot = b.sup === 'hot';
          point(S, 1 - side, scorer); b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.6; b.vz *= 0.6; b.home = 0;
          if (hot) explode(S);
          break;
        }
        contacts(S);
      }
      if (b.swapT > 0 && (b.swapT -= DT / 2) <= 0 && S.decoys.length && b.sup === 'bogo') { const d = S.decoys[Math.floor(Math.random() * S.decoys.length)]; for (const k2 of ['x', 'y', 'z', 'vx', 'vy', 'vz']) { const t2 = b[k2]; b[k2] = d[k2]; d[k2] = t2; } }
      for (const d of S.decoys) {
        ballStep(S, d, DT / 2, false); d.rot += d.vx * DT / 2 / BR;
        let gone = d.y + BR >= GY;
        for (const q of S.players) if (!gone && q.team !== b.supTeam && d3(d.x, d.y, d.z, q.x, q.y - 50 * psc(q), q.z) < 46 * psc(q) + BR) { gone = true; q.st.stun = 1.6 * gutMul(q); q.tis = 2; hurt(S, q, 6); ev(S, 'txt', q.x, q.y - 150, q.z, '사은품 휴지였다…', 2); }
        if (gone) { ev(S, 'poof', d.x, d.y, d.z, '행사 종료', 0); d.dead = true; }
      }
      if (S.decoys.length) S.decoys = S.decoys.filter(d => !d.dead);
    }
    stepItems(S);
  } else if (S.phase === 'point') {
    if (b.cap) { b.cap = false; if (S.ufo) S.ufo.st = 2; }
    b.vy += ballG(S, b) * DT; b.x += b.vx * DT; b.y += b.vy * DT; b.z = clamp(b.z + b.vz * DT, 6, ZD - 6); b.rot += b.vx * DT / BR;
    if (b.y + BR > GY) { b.y = GY - BR; b.vy = -Math.abs(b.vy) * 0.5; b.vx *= 0.8; b.vz *= 0.8; if (Math.abs(b.vy) < 60) b.vy = 0; }
    if (b.x < BR || b.x > CW - BR) { b.vx *= -0.6; b.x = clamp(b.x, BR, CW - BR); }
    S.decoys = [];
    for (const q of S.peels) q.t -= DT;
    if (S.phaseT > 1.9) { if (S.winner >= 0) { S.phase = 'over'; S.phaseT = 0; ev(S, 'over', NETX, 300, ZD / 2, S.winner); } else { if (S.swapNext) { S.swapNext = false; swapSides(S); S.phase = 'swap'; S.phaseT = 0; } else if (!(S.boss && bossAfterPoint(S))) startServe(S); } }
  } else if (S.phase === 'bossev') { bossEvStep(S);
  } else if (S.phase === 'swap') { // v0.40: 코트 변경 — 2초 동안 '코트 변경' 표시, 선수는 새 자리로 걸어간다
    if (S.phaseT > 2.6 + (S.swapHold || 0)) startServe(S); /* v0.56 혼자 하기: 클릭하거나 3초 뒤 시작 */
  }
}

/* ---------- 미리보기(로비의 '필살기 미리보기')용 ---------- */
function drill(S, i) { // i번 선수가 받아 올린 공이 네트 앞에 떠 있는 상태에서 랠리를 시작한다
  const p = S.players[i], b = S.ball, T = p.team; useCourt(S.n);
  S.phase = 'rally'; S.phaseT = 0;
  p.x = netD(T, 330); p.z = ZD / 2; p.hitCd = 0.25;
  b.held = false; b.lastTeam = T; b.lastP = i; b.noP = -1; b.touches = 1; b.serial++; b.teamCd = 0;
  b.x = p.x + fdir(p) * 20; b.y = p.y - 90; b.z = p.z; b.vz = 0;
  lob(S, b, netD(T, 140), ZD / 2, GY - BR, GY - 560);
}
const CHAL = { serve: { name: '서브 과녁', goal: '서브 10번, 과녁 가운데일수록 높은 점수' }, spike: { name: '스파이크 10연속', goal: '날아오는 공을 상대 코트에 연속으로 꽂기(기회 3번)' }, rally: { name: '랠리 30회', goal: 'PC와 공을 30번 주고받기(기회 3번)' } }; // v0.95 도전 모드
function chalMe(S) { return S.players.find(q => !q.bot) || S.players[0]; }
function chalServe(S) { // 서브 시작 때 도전 모드 준비
  const C2 = S.chal, me = chalMe(S), T = me.team, b = S.ball; C2.side = -1;
  for (const q of S.players) q.gone = C2.k !== 'rally' && q.team !== T;
  if (C2.k === 'serve') C2.tgt = { x: oppD(T, rnd(170, 560)), z: rnd(ZD * 0.22, ZD * 0.78) };
  if (C2.k === 'spike') { S.phase = 'rally'; S.phaseT = 0; b.held = false; b.lastTeam = T; b.lastP = -1; b.noP = -1; b.touches = 1; b.chain = 1; S.rallyHits = 1; b.serial++; b.teamCd = 0;
    me.x = netD(T, 260); me.z = ZD / 2; b.x = netD(T, 620); b.y = GY - 160; b.z = ZD / 2 + rnd(-60, 60); lob(S, b, netD(T, rnd(70, 130)), b.z, GY - 300, GY - 560); ev(S, 'txt', b.x, b.y - 60, b.z, '토스!', 0); }
}
function chalPoint(S, team, scorer) { // 도전 모드에서는 점수 대신 기록을 센다
  const C2 = S.chal, me = chalMe(S), b = S.ball, ok = team === me.team; let end = false;
  if (C2.k === 'serve') { let pts = 0; if (ok && C2.tgt) { const d = Math.hypot((b.x - C2.tgt.x) / XS, (b.z - C2.tgt.z) * 1.6); pts = d < 40 ? 3 : d < 80 ? 2 : d < 125 ? 1 : 0; }
    C2.sc += pts; C2.n++; ev(S, 'txt', b.x, 220, b.z, pts ? '+' + pts + (pts === 3 ? ' 한가운데!' : '') : '빗나감', pts ? 1 : 3, 1); C2.best = C2.sc; if (C2.n >= 10) end = true; }
  else if (C2.k === 'spike') { if (ok) { C2.cur++; C2.best = Math.max(C2.best, C2.cur); ev(S, 'txt', NETX, 230, ZD / 2, C2.cur + '연속!', 1, 1); if (C2.cur >= 10) { ev(S, 'txt', NETX, 300, ZD / 2, '도전 성공!!', 1, 1); end = true; } }
    else { C2.n++; ev(S, 'txt', NETX, 230, ZD / 2, '실패… (' + C2.cur + '연속)', 3, 1); C2.cur = 0; if (C2.n >= 3) end = true; } }
  else { C2.best = Math.max(C2.best, C2.cur); C2.n++; ev(S, 'txt', NETX, 230, ZD / 2, C2.cur >= 30 ? '도전 성공!! ' + C2.cur + '회' : '랠리 ' + C2.cur + '회', C2.cur >= 30 ? 1 : 3, 1); if (C2.cur >= 30 || C2.n >= 3) end = true; C2.cur = 0; }
  S.phase = 'point'; S.phaseT = 0; S.pointTeam = team; S.slowT = 0;
  if (end) { C2.done = 1; S.winner = me.team; }
}
function askDouble(S, i) { // v0.95 묻고 떠블로 가: 서브 전에 걸면 다음 한 점이 2점(지면 상대가 2점). 경기당 팀마다 1번
  const p = S.players[i]; if (!p || S.phase !== 'serve' || S.winner >= 0 || S.tut || S.boss) return false;
  const D = S.dbl || (S.dbl = { on: -1, used: [0, 0] }); if (D.on >= 0 || D.used[p.team]) return false;
  D.on = p.team; D.used[p.team] = 1; ev(S, 'dbl', NETX, 220, ZD / 2, p.team); return true;
}
function forceSup(S, i) { const p = S.players[i]; if (p.gauge >= 100 && S.phase === 'rally' && !S.cut && !p.ko) trySuper(S, p); } // 조건을 따지지 않고 지금 필살기를 쓴다

/* ===================== v1.28 보스전: 다크 빱찌 =====================
   우리 팀(team 0, 3명)이 왼쪽, 보스가 혼자 오른쪽 코트. 우리 공이 보스 코트에 떨어지면 보스 체력이 깎이고, 놓치면 팀 하트가 깎인다.
   S.boss 에 보스 상태를 모두 담는다(서버가 진행, 스냅샷 'bo' 로 보낸다). 기믹 12가지:
   1 예고 스파이크(가짜 원) 2 멀티볼(황금 공만 진짜) 3 브레이크(기 모으기 중 2점 내면 그로기) 4 졸개(빚쟁이 쥐: 밟거나 공·다이빙으로 쫓아냄)
   5 통장 압류(모두 동시에 점프) 6 색깔 방패(같은 색 발판을 밟은 사람의 공만 방패를 깬다) 7 무적+치즈 구슬 8 코트 변형(빙판·철망)
   9 바닥 휩쓸기(점프로 피함) 10 카운터(번쩍일 때 블로킹하면 튕겨내기) 11 저주(방향키 반대·어둠) 12 발악(1%) */
const BOSSES = { dark: { name: '다크 빱찌', title: '통장 털이 서큐보스', hp: 10000, hearts: 9, limit: 330 } };
const BOSS_KINDS = { 1: [['lob', 30], ['spike', 45], ['tele', 15], ['multi', 10]], 2: [['lob', 20], ['spike', 45], ['tele', 20], ['multi', 15]], 3: [['lob', 10], ['spike', 45], ['tele', 25], ['multi', 20]], rage: [['spike', 40], ['tele', 30], ['multi', 30]] };
const BOSS_CD = { summon: 26, sweep: 13, curse: 24, court: 26, charge: 34, shield: 40 };
const BOSS_DIFF = { easy: 0.75, normal: 1, hard: 1.15, hell: 1.3 };
function pickW(list) { let s = 0; for (const q of list) s += q[1]; let r = Math.random() * s; for (const q of list) { if ((r -= q[1]) < 0) return q[0]; } return list[0][0]; }
function bossInit(S, id) {
  const D = BOSSES[id] || BOSSES.dark;
  S.boss = { id: BOSSES[id] ? id : 'dark', hp: D.hp, hpMax: D.hp, hearts: D.hearts, heartsMax: D.hearts, ph: 1, st: 'idle', stT: 0, x: oppD(0, 420), z: ZD / 2, clock: 0, limit: D.limit,
    recvSer: -1, recvOk: false, hold: null, marks: [], fakes: [], mets: [], metT: 0, rats: [], ratT: 0, groggy: 0, charge: null, shield: null, orbs: null, orbT: 0, imm: false, cage: 0, dark: 0, sweep: null, cwSer: -1,
    evq: [], ev: null, done: {}, cd: { summon: 10, sweep: 7, curse: 0, court: 0, charge: 0, shield: 0 }, rage: null, exh: false, dead: false, serveNext: false, lastKind: '', dmgN: 0 };
  for (const p of S.players) p.bcol = p.slot % 2; // 6 색깔 방패: 처음 색(빨강 0 / 파랑 1)
}
function bossHome(S) { return [oppD(0, 400), ZD / 2]; }
function bossHand(S) { const B = S.boss; return [B.x - 46 * XS, GY - 330, B.z]; }
function bossSay(S, s, col) { ev(S, 'txt', S.boss.x, GY - 470, S.boss.z, s, col == null ? 3 : col, 1); }
function bossSt(B, st) { if (B.st !== st) { B.st = st; B.stT = 0; } }
function aiD(S) { return S.boss ? 'normal' : S.diff; } // v1.29 보스전에서 난이도는 보스만 바꾼다(우리 편 PC는 늘 보통 실력)
const BOSS_ALLY = { react: 0.23, err: 20, block: 0.3, dive: 0.55, perf: 0.1, two: 0.14, sup: 0.8, chg: 0.55, miss: 0.22, counter: 0.3, dig: 0.25 }; // v1.30 보스전 우리 편 PC 실력은 v1.29 보통 그대로(일반 대전 보통만 쉬워짐)
function aiDf(S) { return S.boss ? BOSS_ALLY : (DIFFS[S.diff] || DIFFS.normal); }
function bossRecvChance(S) {
  const B = S.boss, b = S.ball, base = B.rage ? 0.82 : [0, 0.72, 0.76, 0.8][B.ph]; // v1.29 보스가 리시브를 더 잘한다(전 0.42·0.47·0.52)
  if (b.sup || B.groggy > 0 || B.exh || B.charge || b.parry || S.ufo) return 0;
  let k = base * (b.power ? 0.85 : 1) * (b.ultra ? 0.9 : 1) * (B.shield ? 0.85 : 1) * (BOSS_DIFF[S.diff] || 1);
  const L = S.pred && S.pred.land; if (L && Math.hypot(L.x - B.x, (L.z - B.z) * 1.3) > 380 * XS) k *= 0.85;
  return clamp(k, 0, 0.93);
}
function bossServeStart(S) { // 우리가 점수를 잃었으면 다음 공은 보스가 친다
  const B = S.boss, b = S.ball; if (!B.serveNext) return;
  B.serveNext = false; const h = bossHand(S); b.held = false; b.x = h[0]; b.y = h[1]; b.z = h[2]; b.vx = b.vy = b.vz = 0; b.lastTeam = 1; b.lastP = -1; b.touches = 0; b.serial++;
  S.phase = 'rally'; S.phaseT = 0; bossHold(S, B.ph === 1 ? (Math.random() < 0.6 ? 'lob' : 'spike') : pickW(BOSS_KINDS[B.rage ? 'rage' : B.ph]), 1.3);
}
function bossHold(S, kind, t) {
  const B = S.boss; B.hold = { kind, t: t || (kind === 'tele' ? 1.0 : kind === 'spike' ? 0.6 : kind === 'multi' ? 0.7 : 0.4), t0: 0 };
  bossSt(B, kind === 'spike' ? 'wind' : kind === 'tele' || kind === 'multi' ? 'cast' : 'toss');
  if (kind === 'spike' && (Math.random() < 0.55 || B.rage)) { B.hold.cw = 1; B.hold.t += 0.2; /* v1.37 번쩍임 예고를 0.2초 길게 */ ev(S, 'bossFlash', B.x, GY - 330, B.z); } // 10 카운터 찬스: 몸이 번쩍인다
  if (kind === 'tele') { // 1 예고: 우리 코트에 원 3~4개(진짜는 하나)
    const n = B.ph >= 3 || B.rage ? 4 : 3, os = openSpot(S, 1); B.marks = [{ x: os[0], z: os[1], real: 1 }];
    for (let i = 1; i < n; i++) { let x, z, k = 0; do { x = netD(0, rnd(90, 560)); z = rnd(50, ZD - 50); k++; } while (k < 20 && B.marks.some(m => Math.hypot(m.x - x, (m.z - z) * 1.3) < 170 * XS)); B.marks.push({ x, z, real: 0 }); }
    B.marks.sort(() => Math.random() - 0.5); ev(S, 'bossMarks', NETX, GY, ZD / 2, n);
  }
}
function bossLaunch(S) { // 들고 있던 공을 우리 코트로
  const B = S.boss, b = S.ball, H = B.hold, kind = H.kind, sp = (B.rage ? 1500 : [0, 1250, 1380, 1460][B.ph]) * (S.diff === 'easy' ? 0.88 : S.diff === 'hard' ? 1.06 : S.diff === 'hell' ? 1.12 : 1);
  B.hold = null; b.lastKind = kind === 'spike' || kind === 'cannon' ? 'spike' : 'bump'; b.lastTeam = 1; b.lastP = -1; b.noP = -1; b.touches = 0; b.chain = 0; b.nice = 0; b.serial++; b.teamCd = 0.15; b.power = false; b.sup = null; b.home = 0; b.float = 0; b.out = false; b.gold = false; b.unrecv = false; b.parry = false; b.full = false;
  S.rallyHits++; B.lastKind = kind;
  if (kind === 'lob') { lobOver(S, b, 1, rnd(150, 520), rnd(60, ZD - 60), rnd(-40, 40), GY - rnd(430, 560)); bossSt(B, 'toss'); ev(S, 'bump', b.x, b.y, b.z, 0); }
  else if (kind === 'spike') { const os = openSpot(S, 1); drive(S, b, clamp(os[0] + rnd(-60, 60) * XS, netD(0, 560), netD(0, 70)), cz(os[1] + rnd(-50, 50)), GY - BR, sp); b.power = true; b.full = B.ph >= 2; bossSt(B, 'spike'); if (H.cw) B.cwSer = b.serial; ev(S, 'spike', b.x, b.y, b.z, B.ph >= 2 ? 1 : 0, -1); ev(S, 'hit', b.x, b.y, b.z, 3, -1); S.stopT = 0.06; }
  else if (kind === 'tele') { const m = B.marks.find(q => q.real) || { x: netD(0, 300), z: ZD / 2 }; lob(S, b, m.x, m.z, GY - BR, GY - 640); bossSt(B, 'toss'); ev(S, 'bump', b.x, b.y, b.z, 1); bossSay(S, '어디로 떨어질까~?', 0); }
  else if (kind === 'multi') { // 2 멀티볼: 황금 공만 진짜
    const t = [[rnd(120, 260), rnd(0.15, 0.4)], [rnd(300, 520), rnd(0.6, 0.85)], [rnd(160, 480), rnd(0.4, 0.6)]].sort(() => Math.random() - 0.5);
    B.fakes = []; for (let i = 0; i < 2; i++) { const q = { x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, rot: 0, float: 0 }; lob(S, q, netD(0, t[i][0]), t[i][1] * ZD, GY - BR, GY - rnd(420, 560)); B.fakes.push(q); }
    lob(S, b, netD(0, t[2][0]), t[2][1] * ZD, GY - BR, GY - rnd(420, 560)); b.gold = true; bossSt(B, 'toss'); ev(S, 'bossMulti', b.x, b.y, b.z); bossSay(S, '진짜는 하나뿐~', 0);
  }
  else if (kind === 'cannon') { const os = openSpot(S, 1); drive(S, b, os[0], os[1], GY - BR, 2100); b.power = true; b.unrecv = true; bossSt(B, 'spike'); ev(S, 'bossCannon', b.x, b.y, b.z); ev(S, 'shake', NETX, GY, ZD / 2, 3); S.stopT = 0.12; }
  if (kind !== 'tele') B.marks = [];
  bossSkill(S);
}
function bossSkillOk(S, k) {
  const B = S.boss; if (B.cd[k] > 0) return false;
  if (k === 'summon') return !B.rats.length;
  if (k === 'charge' || k === 'shield') return B.ph >= 2 && !B.charge && !B.shield && !B.orbs && !(B.groggy > 0) && !B.rage;
  if (k === 'curse' || k === 'court') return B.ph >= 2;
  return true;
}
function bossSkill(S) { // 공을 보낸 순간 가끔 기술을 하나 더 쓴다
  const B = S.boss; if (B.rage) { if (B.cd.sweep <= 0) bossDo(S, 'sweep'); return; }
  const ready = ['summon', 'sweep', 'curse', 'court', 'charge', 'shield'].filter(k => bossSkillOk(S, k)), U = B.used || (B.used = {}), fresh = ready.filter(k => !U[k] || (k === 'curse' || k === 'court') && U[k] < 2); // v1.37 아직 안 보여 준 기술(저주·코트는 두 종류 다)을 먼저 쓴다
  if (!ready.length || Math.random() < (fresh.length ? 0.15 : 0.35)) return;
  const pool = fresh.length ? fresh : ready; bossDo(S, pool[Math.floor(Math.random() * pool.length)]);
}
function bossDo(S, k) {
  const B = S.boss, f = B.rage ? 0.4 : B.ph >= 3 ? 0.75 : 1; B.cd[k] = BOSS_CD[k] * f * rnd(0.85, 1.15);
  const U = B.used || (B.used = {}), nU = U[k] = (U[k] || 0) + 1, alt = nU <= 2 ? (nU === 1) === (B.altF == null ? (B.altF = Math.random() < 0.5) : B.altF) : Math.random() < 0.5; // v1.37 저주·코트 변형은 처음 두 번은 서로 다른 종류
  if (k === 'summon') { // 4 졸개
    const n = B.ph >= 2 ? 4 : 3; B.rats = []; for (let i = 0; i < n; i++) B.rats.push({ x: netD(0, rnd(80, 560)), z: rnd(40, ZD - 40), vx: 0, vz: 0, t: rnd(0, 2), k: i % 2 && B.ph >= 2 ? 1 : 0, cd: 0 });
    B.ratT = 15; bossSt(B, 'summon'); ev(S, 'bossSummon', netD(0, 300), GY, ZD / 2, n); bossSay(S, '얘들아, 수금해 와!');
  } else if (k === 'sweep') { // 9 바닥 휩쓸기
    B.sweep = { x: NETX - 10, warn: 0.8, sp: 760 * XS * (B.ph >= 3 || B.rage ? 1.2 : 1), hit: {} }; bossSt(B, 'sweep'); ev(S, 'bossSweep', NETX, GY, ZD / 2); bossSay(S, '점프해 봐~!', 0);
  } else if (k === 'curse') { // 11 저주
    if (alt) { B.dark = 9; ev(S, 'bossDark', NETX, GY, ZD / 2); bossSay(S, '불 꺼졌다~♪'); }
    else { const ps = S.players.filter(q => !q.ko).sort(() => Math.random() - 0.5).slice(0, 2); for (const q of ps) { q.st.rev = 7; ev(S, 'txt', q.x, q.y - 180, q.z, '방향키 반대!', 2); } ev(S, 'bossCurse', NETX, GY, ZD / 2); bossSay(S, '왼쪽이 오른쪽~'); }
    bossSt(B, 'taunt');
  } else if (k === 'court') { // 8 코트 변형
    if (alt) { S.ice[0] = 10; ev(S, 'freeze', netD(0, 300), GY - 20, ZD / 2, '빙판 주의!', 3); bossSay(S, '꽁꽁 얼어라~'); }
    else { B.cage = 12; ev(S, 'bossCage', NETX, NETTOP, ZD / 2); bossSay(S, '철망 세웠지롱! 높이 넘겨 봐'); }
    bossSt(B, 'cast');
  } else if (k === 'charge') { // 3 브레이크
    const need = 2; B.charge = { t: 9, need, got: 0 }; bossSt(B, 'charge'); ev(S, 'bossCharge', B.x, GY - 300, B.z, need); bossSay(S, '기 모으는 중… 방해하면 안 돼!');
  } else if (k === 'shield') { // 6 색깔 방패
    B.shield = { col: Math.random() < 0.5 ? 0 : 1, hp: 3, t: 40 }; bossSt(B, 'shield'); ev(S, 'bossShield', B.x, GY - 250, B.z, B.shield.col); bossSay(S, '같은 색만 통한다구~');
  }
}
function bossStep(S) {
  const B = S.boss, b = S.ball; if (!B) return;
  B.stT += DT;
  if (B.must && B.must.length && S.phase === 'rally' && B.ph >= 2 && !B.charge && !B.shield && !B.orbs && !B.rage && S.winner < 0) bossDo(S, B.must.shift()); // v1.37 각성 뒤 기 모으기·색 방패는 조건이 되면 바로(꼭 한 번씩)
  if (S.phase === 'rally' || S.phase === 'serve' || S.phase === 'point') { B.clock += DT; if (B.clock >= B.limit && !B.done.doom && S.winner < 0) { B.done.doom = 1; B.evq.push('doom'); } }
  const live = S.phase === 'rally';
  if (live) for (const k in B.cd) if (B.cd[k] > 0) B.cd[k] -= DT;
  if (B.groggy > 0 && live) { B.groggy = Math.max(0, B.groggy - DT); bossSt(B, 'groggy'); if (B.groggy <= 0 && !B.exh) bossSt(B, 'idle'); }
  if (B.exh) bossSt(B, 'groggy');
  if (live && B.cage > 0) B.cage -= DT; if (live && B.dark > 0) B.dark -= DT;
  // 보스 이동: 공이 우리 쪽에서 넘어오면 떨어질 곳으로, 아니면 제자리
  { let tx, tz; const L = S.pred && S.pred.land, inc = live && !b.held && b.lastTeam === 0 && !B.hold;
    if (B.groggy > 0 || B.exh || B.charge) { const h = bossHome(S); tx = h[0]; tz = h[1]; }
    else if (inc && L && L.x > NETX) { tx = L.x + 30 * XS; tz = L.z; } else if (B.hold) { tx = B.x; tz = B.z; } else { const h = bossHome(S), r = B.rage ? 1 : 0; tx = h[0] + Math.sin(B.clock * (1.2 + r * 0.7)) * (120 + r * 50) * XS; tz = h[1] + Math.sin(B.clock * (0.85 + r * 0.45) + 1) * ZD * (0.22 + r * 0.08); } // v1.30 가만히 서 있지 않고 늘 이리저리 떠다닌다(발악 때 더 크게·빠르게)
    tx = clamp(tx, NETX + 150 * XS, CW - 90 * XS); tz = clamp(tz, ZD * 0.18, ZD * 0.82);
    const sp = (inc ? 950 : B.rage ? 640 : 480) * XS * DT, dx = tx - B.x, dz = tz - B.z, d = Math.hypot(dx, dz); if (d > 1) { const m = Math.min(1, sp / d); B.x += dx * m; B.z += dz * m; }
    if (!B.hold && !B.groggy && !B.exh && !B.charge && !B.shield && B.stT > 0.9 && ['spike', 'toss', 'cast', 'summon', 'sweep', 'taunt', 'flinch', 'wind'].includes(B.st)) bossSt(B, d > 40 ? 'move' : 'idle');
    if (B.st === 'idle' && d > 40) bossSt(B, 'move'); if (B.st === 'move' && d <= 40) bossSt(B, 'idle'); }
  if (B.charge && live) { B.charge.t -= DT; bossSt(B, 'charge'); if (B.charge.t <= 0) { B.charge = null; bossSay(S, '암흑 대포 발사!!'); if (!b.held && !B.hold && b.lastTeam === 1 && sideOf(b.x) === 0) { /* 공이 우리 쪽이면 바로 발사 */ } B.cannon = true; } }
  if (B.shield && live) { B.shield.t -= DT; if (B.shield.t <= 0) { B.shield = null; ev(S, 'txt', B.x, GY - 400, B.z, '(방패가 사라졌다)', 0); } }
  if (B.orbs && live) { // 7 무적 + 치즈 구슬
    B.orbT -= DT; for (const o of B.orbs) { o.ph += DT; o.y = o.y0 + Math.sin(o.ph * 1.6) * 26; }
    if (!b.held && b.lastTeam === 0 && sideOf(b.x) === 1) for (const o of B.orbs) if (!o.dead && d3(b.x, b.y, b.z, o.x, o.y, o.z) < 110) { o.dead = true; ev(S, 'bossOrb', o.x, o.y, o.z, B.orbs.filter(q => !q.dead).length); }
    if (B.orbs.every(o => o.dead)) { B.orbs = null; B.imm = false; B.groggy = 6; bossSt(B, 'groggy'); ev(S, 'bossOrbDone', B.x, GY - 300, B.z); bossSay(S, '내 방패가…!!', 2); }
    else if (B.orbT <= 0) { B.orbs = null; B.imm = false; ev(S, 'bossBlast', NETX, GY, ZD / 2); bossLoseHeart(S, 1, '마력 폭발!'); for (const q of S.players) if (!q.ko) knock(S, q, 0.8, -1); }
  }
  if (B.rage && live) { // v1.29 발악: 가만히 있지 않고 2~3초마다 우리 선수 발밑에 암흑 운석을 떨어뜨린다(빨간 원이 뜨고 1.1초 뒤 쾅)
    B.metT -= DT; if (B.metT <= 0) { B.metT = rnd(2.4, 3.2); const al = S.players.filter(q => !q.ko), n = Math.min(al.length, Math.random() < 0.6 ? 1 : 2);
      for (let i = 0; i < n; i++) { const q = al[(i + S.tick) % al.length]; B.mets.push({ x: clamp(q.x + rnd(-50, 50) * XS, 40 * XS, NETX - 40 * XS), z: clamp(q.z + rnd(-40, 40), 25, ZD - 25), t: 1.1 }); }
      bossSt(B, Math.random() < 0.5 ? 'cast' : 'roar'); ev(S, 'bossMeteor', B.x, GY - 300, B.z, n); } }
  if (B.mets.length) { for (const m of B.mets) { m.t -= DT; if (m.t <= 0 && !m.hit) { m.hit = 1; ev(S, 'bossMetHit', m.x, GY, m.z);
        for (const q of S.players) if (!q.ko && q.st.down <= 0 && Math.hypot(q.x - m.x, (q.z - m.z) * 1.3) < 70 * XS && q.y > GY - 70) { knock(S, q, 0.7, -1); hurt(S, q, 6); ev(S, 'txt', q.x, q.y - 160, q.z, '쾅!', 2); } } }
    B.mets = B.mets.filter(m => m.t > -0.4); }
  if (B.rage && live) { B.rage.t -= DT; if (B.rage.t <= 0) { B.rage = null; B.mets = []; B.imm = false; B.exh = true; B.dark = 0; bossSt(B, 'groggy'); ev(S, 'bossExh', B.x, GY - 300, B.z); bossSay(S, '헉… 헉… 힘이 없어…', 2); } }
  // 9 바닥 휩쓸기
  if (B.sweep && (live || S.phase === 'point')) { const W2 = B.sweep; if (W2.warn > 0) W2.warn -= DT; else { W2.x -= W2.sp * DT;
      for (const q of S.players) if (!q.ko && !W2.hit[q.i] && Math.abs(q.x - W2.x) < 40 * XS && q.gnd && q.y > GY - 20 && q.st.down <= 0) { W2.hit[q.i] = 1; knock(S, q, 0.9, -1); hurt(S, q, 8); ev(S, 'txt', q.x, q.y - 160, q.z, '휩쓸렸다!', 2); }
      if (W2.x < -40) B.sweep = null; } }
  // 4 졸개
  if (B.rats.length && (live || S.phase === 'serve' || S.phase === 'point')) {
    if (live) B.ratT -= DT;
    for (const r of B.rats) { if (r.dead) continue; r.t += DT; if (r.cd > 0) r.cd -= DT;
      if (Math.random() < DT * 0.8 || (!r.vx && !r.vz)) { const a = rnd(0, 6.28), v = (r.k ? 150 : 110) * XS; r.vx = Math.cos(a) * v; r.vz = Math.sin(a) * v * 0.6; }
      r.x = clamp(r.x + r.vx * DT, 40 * XS, NETX - 50 * XS); r.z = clamp(r.z + r.vz * DT, 30, ZD - 30); if (r.x <= 40 * XS || r.x >= NETX - 50 * XS) r.vx = -r.vx; if (r.z <= 30 || r.z >= ZD - 30) r.vz = -r.vz;
      for (const q of S.players) { if (q.ko) continue; const d = Math.hypot(q.x - r.x, (q.z - r.z) * 1.2);
        if ((!q.gnd && q.vy > 0 && q.y > GY - 70 && d < 52 * XS) || (q.act === 'dive' && d < 64 * XS)) { r.dead = true; ev(S, 'bossRat', r.x, GY, r.z, 1); ev(S, 'txt', r.x, GY - 90, r.z, '쭈욱!', 1); break; }
        if (r.cd <= 0 && q.gnd && q.st.down <= 0 && d < 34 * XS && Math.hypot(q.vx, q.vz) > 120) { r.cd = 2.5; q.st.stun = Math.max(q.st.stun, 0.45); q.act = 'idle'; q.chg = 0; ev(S, 'txt', q.x, q.y - 150, q.z, '쥐에 걸려 휘청!', 2); } }
      if (!r.dead && !b.held && b.y > GY - 90 && Math.hypot(b.x - r.x, (b.z - r.z) * 1.2) < 60 * XS) { r.dead = true; ev(S, 'bossRat', r.x, GY, r.z, 2); ev(S, 'txt', r.x, GY - 90, r.z, '공에 맞아 도망!', 1); } }
    if (B.rats.every(r => r.dead)) { B.rats = []; if (!B.exh && !B.imm) { B.groggy = Math.max(B.groggy, 4); bossSt(B, 'groggy'); ev(S, 'bossHesitate', B.x, GY - 300, B.z); bossSay(S, '어… 어? 내 졸개들이…', 2); } }
    else if (B.ratT <= 0) { const n = B.rats.filter(r => !r.dead).length; B.rats = []; ev(S, 'bossRatSteal', NETX, GY, ZD / 2, n); bossLoseHeart(S, 1, '빚 수금 완료~'); }
  }
  // 6 색깔 발판: 밟으면 그 색
  if (B.shield) for (const q of S.players) for (const pd of bossPads(S)) if (q.gnd && Math.hypot(q.x - pd[0], (q.z - pd[1]) * 1.2) < 46 * XS && q.bcol !== pd[2]) { q.bcol = pd[2]; ev(S, 'bossCol', q.x, q.y - 120, q.z, pd[2], q.i); }
  // 2 가짜 공
  if (B.fakes.length) { for (const f of B.fakes) { ballStep(S, f, DT, false); f.rot += f.vx * DT / BR; let gone = f.y + BR >= GY; for (const q of S.players) if (!gone && d3(f.x, f.y, f.z, q.x, q.y - 50 * psc(q), q.z) < 46 * psc(q) + BR) { gone = true; ev(S, 'txt', q.x, q.y - 150, q.z, '가짜였다!', 0); } if (gone) { ev(S, 'poof', f.x, f.y, f.z, '가짜!', 0); f.dead = true; } } B.fakes = B.fakes.filter(f => !f.dead); }
  if (!live) return;
  // 받기 판정: 우리 공이 보스 코트로 내려오면 한 번만 정한다
  if (!B.hold && !b.held && !b.cap && b.lastTeam === 0 && sideOf(b.x) === 1 && B.recvSer !== b.serial && !(S.netLive && S.netLive.mode)) {
    const L = S.pred && S.pred.land, out = b.out || (L && (L.x > CW || L.z < 0 || L.z > ZD));
    if (!out && b.vy > 0 && b.y > GY - 230) { B.recvSer = b.serial; B.recvOk = Math.random() < bossRecvChance(S); if (!B.recvOk && !B.groggy && !B.exh) { bossSt(B, 'flinch'); } }
  }
  if (!B.hold && B.recvSer === b.serial && B.recvOk && b.lastTeam === 0 && sideOf(b.x) === 1 && b.y > GY - 200) { // 받아서 들고 있다가 기술로 돌려보낸다
    B.recvOk = false; b.vx = b.vy = b.vz = 0; const kind = B.cannon ? 'cannon' : pickW(BOSS_KINDS[B.rage ? 'rage' : B.ph]); B.cannon = false; bossHold(S, kind); ev(S, 'bossCatch', b.x, b.y, b.z);
  }
  if (B.cannon && !B.hold && b.lastTeam === 1 && sideOf(b.x) === 0 && !b.held) { /* 공이 우리 쪽에 있으면 다음에 보스가 받을 때 쏜다 */ }
}
function bossHolding(S) { // S.phase === 'rally' 이고 보스가 공을 들고 있을 때(공은 멈춘 채 보스 손 쪽으로)
  const B = S.boss, b = S.ball, H = B.hold, h = bossHand(S); H.t0 += DT;
  const k = Math.min(1, DT * 10); b.x += (h[0] - b.x) * k; b.y += (h[1] - 40 - b.y) * k; b.z += (h[2] - b.z) * k; b.vx = b.vy = b.vz = 0; b.rot += 0.2;
  if (H.t0 >= H.t) bossLaunch(S);
}
function bossPads(S) { return [[netD(0, 330), ZD * 0.2, 0], [netD(0, 330), ZD * 0.8, 1]]; }
function bossLoseHeart(S, n, why) {
  const B = S.boss; B.hearts = Math.max(0, B.hearts - n); ev(S, 'bossHeart', NETX, GY, ZD / 2, -n); if (why) ev(S, 'txt', netD(0, 300), 230, ZD / 2, why + ' 하트 -' + n, 2, 1);
  if (B.hearts <= 0 && S.winner < 0) { S.winner = 1; if (S.phase === 'rally') { S.phase = 'point'; S.phaseT = 0; S.pointTeam = 1; } ev(S, 'point', S.ball.x, GY, S.ball.z, 1, 1); }
}
function bossPoint(S, team, scorer) { // point() 대신
  const B = S.boss, b = S.ball;
  S.phase = 'point'; S.phaseT = 0; S.pointTeam = team; S.slowCmb = false; S.slowT = 0; B.hold = null; B.marks = []; B.fakes = [];
  { const R = S.ref; if (R) { if (R.n > 0) R.n--; if (R.st !== 2) { R.st = 1; R.t = 0; } } }
  for (const q of S.players) { if (q.tis > 0) q.tis--; if (q.supBan > 0) q.supBan--; }
  if (team === 0) {
    S.score[0]++; if (scorer >= 0) { S.players[scorer].stats.pts++; addGauge(S.players[scorer], 18); }
    for (const q of S.players) { addGauge(q, chOf(q).id === 'midwae' ? 18 : 8); if (q.gnd && !busy(q)) { q.vy = -rnd(330, 470); q.gnd = false; q.act = 'idle'; q.chg = 0; } }
    const sc = scorer >= 0 ? S.players[scorer] : null;
    if (B.charge) { B.charge.got++; ev(S, 'bossBreakHit', B.x, GY - 300, B.z, B.charge.got, B.charge.need); if (B.charge.got >= B.charge.need) { B.charge = null; B.groggy = 6; bossSt(B, 'groggy'); ev(S, 'bossBreak', B.x, GY - 300, B.z); bossSay(S, '꺄악! 기가 흩어졌어…', 2); } }
    if (B.shield) { const ok = sc && sc.bcol === B.shield.col; if (ok) { B.shield.hp--; ev(S, 'bossShieldHit', B.x, GY - 250, B.z, B.shield.hp); if (B.shield.hp <= 0) { B.shield = null; B.groggy = Math.max(B.groggy, 4); bossSt(B, 'groggy'); ev(S, 'bossShieldBreak', B.x, GY - 250, B.z); bossSay(S, '방패가 깨졌어?!', 2); } else { B.shield.col = 1 - B.shield.col; ev(S, 'bossShield', B.x, GY - 250, B.z, B.shield.col); } } else ev(S, 'txt', B.x, GY - 420, B.z, sc ? '색이 달라! (발판을 밟아 색 바꾸기)' : '방패에 막혔다', 0, 1); }
    else if (B.imm && !B.exh) ev(S, 'txt', B.x, GY - 420, B.z, B.orbs ? '무적! 치즈 구슬을 공으로 깨!' : '무적!', 0, 1);
    else { // 데미지
      let d = 740 + (b.power ? 140 : 0) + (b.ultra ? 180 : 0) + (b.sup ? 450 : 0), crit = false;
      if (b.power && Math.random() < 0.18) { d *= 1.8; crit = true; }
      if (B.groggy > 0 || B.exh) d *= 2; if (b.parry) d *= 1.5;
      d = Math.round(d * rnd(0.92, 1.08));
      const floor = B.done.rage ? 0 : B.hpMax * 0.01; if (B.exh) d = B.hp; B.hp = Math.max(floor, B.hp - d); if (!B.done.rage && B.hp <= floor) B.hp = floor;
      B.dmgN++; ev(S, 'bossDmg', b.x, GY - 40, b.z, d, (crit ? 1 : 0) | (B.groggy > 0 || B.exh ? 2 : 0) | (b.parry ? 4 : 0));
      if (!B.groggy && !B.exh) bossSt(B, 'flinch');
      const r = B.hp / B.hpMax;
      if (B.hp <= 0) { B.dead = true; S.winner = 0; bossSt(B, 'dead'); ev(S, 'bossDead', B.x, GY - 200, B.z); S.slowT = 1.6; }
      else { if (r <= 0.7 && !B.done.tf) { B.done.tf = 1; B.evq.push('tf'); } if (r <= 0.5 && !B.done.s50) { B.done.s50 = 1; B.evq.push('seize'); } if (r <= 0.35 && !B.done.orb) { B.done.orb = 1; B.evq.push('orb'); } if (r <= 0.2 && !B.done.s20) { B.done.s20 = 1; B.evq.push('seize'); } if (r <= 0.0101 && !B.done.rage) { B.done.rage = 1; B.evq.push('rage'); } }
    }
    S.serveTeam = 0;
  } else {
    S.score[1]++; for (const q of S.players) addGauge(q, 14);
    bossLoseHeart(S, 1, ''); B.serveNext = true; S.serveTeam = 0; if (S.winner < 0) bossSt(B, 'taunt');
  }
  S.serveIdx[0]++;
  ev(S, 'point', b.x, GY, b.z, team, S.winner >= 0 ? 1 : 0);
}
function bossAfterPoint(S) { // 점수 연출이 끝난 뒤: 대기 중인 보스 이벤트가 있으면 먼저
  const B = S.boss; if (B.evq.length && S.winner < 0) { bossEvStart(S, B.evq.shift()); return true; } return false;
}
function bossEvStart(S, k) {
  const B = S.boss, b = S.ball; S.phase = 'bossev'; S.phaseT = 0; B.ev = { k, t: 0, dur: { tf: 2.8, seize: 5.6, orb: 2.4, rage: 2.6, doom: 4.2 }[k] || 2, done: 0 };
  b.held = true; b.x = -999; b.vx = b.vy = b.vz = 0; B.hold = null; B.marks = []; B.fakes = []; B.sweep = null;
  for (const q of S.players) { q.act = 'idle'; q.chg = 0; q.jt = k === 'seize' ? 5.0 - 0.26 + rnd(-1, 1) * ({ easy: 0.24, normal: 0.17, hard: 0.11, hell: 0.07 }[aiD(S)] || 0.17) : 99; }
  if (k === 'tf') { B.ph = 2; B.must = Math.random() < 0.5 ? ['charge', 'shield'] : ['shield', 'charge']; /* v1.37 각성하면 기 모으기·색 방패는 꼭 한 번씩 */ bossSt(B, 'tf'); ev(S, 'bossTf', B.x, GY - 300, B.z, 2); bossSay(S, '이제부터 진짜야!!', 2); }
  else if (k === 'seize') { bossSt(B, 'roar'); ev(S, 'bossSeize', netD(0, 330), GY, ZD / 2, 5); bossSay(S, '통장 압류!!', 2); }
  else if (k === 'orb') { B.imm = true; B.charge = null; B.shield = null; B.orbs = []; B.orbT = 40; for (let i = 0; i < 3; i++) { const y0 = GY - rnd(190, 330); B.orbs.push({ x: oppD(0, 70 + i * 70 + rnd(-15, 15)), y: y0, y0, z: ZD * [0.3, 0.7, 0.5][i] + rnd(-20, 20), ph: rnd(0, 6.28), dead: false }); } bossSt(B, 'shield'); ev(S, 'bossOrbs', B.x, GY - 300, B.z, 3); bossSay(S, '무적이다~ 치즈 구슬을 깨 볼 테면 깨 봐!'); if (B.ph < 3) B.ph = 3; }
  else if (k === 'rage') { B.imm = true; B.charge = null; B.shield = null; B.rage = { t: 15 }; B.dark = 15; B.ph = 3; bossSt(B, 'roar'); ev(S, 'bossRage', B.x, GY - 300, B.z); bossSay(S, '이대로 질 순 없어!!!', 2); }
  else if (k === 'doom') { bossSt(B, 'roar'); ev(S, 'bossDoom', NETX, GY, ZD / 2); bossSay(S, '시간 끝~ 최후의 압류!!', 2); }
}
function bossEvStep(S) {
  const B = S.boss, E = B.ev; if (!E) { startServe(S); return; } E.t += DT;
  if (E.k === 'seize') {
    if (!E.done && E.t >= 5.0) { E.done = 1; const alive = S.players.filter(q => !q.ko && q.st.down <= 0), ok = alive.length > 0 && alive.every(q => !q.gnd || q.y < GY - 25);
      if (ok) { B.groggy = 6; bossSt(B, 'groggy'); ev(S, 'bossSeizeOk', netD(0, 330), GY - 200, ZD / 2); bossSay(S, '뭐?! 다 같이 막았다고?', 2); }
      else { ev(S, 'bossSeizeFail', netD(0, 330), GY, ZD / 2); ev(S, 'shake', NETX, GY, ZD / 2, 3); for (const q of S.players) if (q.gnd && !q.ko) knock(S, q, 0.7, -1); bossLoseHeart(S, 2, '통장 압류!'); } }
  } else if (E.k === 'doom') { if (!E.done && E.t >= 3.2) { E.done = 1; ev(S, 'bossSeizeFail', netD(0, 330), GY, ZD / 2); ev(S, 'shake', NETX, GY, ZD / 2, 4); bossLoseHeart(S, 99, '최후의 압류!'); } }
  if (E.t >= E.dur) { B.ev = null; if (S.winner >= 0) { S.phase = 'over'; S.phaseT = 0; ev(S, 'over', NETX, 300, ZD / 2, S.winner); } else if (B.evq.length) bossEvStart(S, B.evq.shift()); else startServe(S); }
}
function bossBots(S) { // PC 팀원의 보스전 행동(졸개 밟기·휩쓸기 피하기·발판 밟기)
  const B = S.boss, b = S.ball; if (S.phase !== 'rally') return;
  const free = !b.held && (B.hold || (b.lastTeam === 0 && sideOf(b.x) === 1));
  const H = B.hold, cwq = H && H.cw && !B.rage ? S.players.filter(q => q.bot && !q.ko && q.st.down <= 0).sort((a, c) => Math.abs(a.x - NETX) - Math.abs(c.x - NETX))[0] : null; // v1.37 보스가 번쩍이면 네트 가까운 PC가 가끔 블로킹(카운터)을 노린다
  if (cwq && (busy(cwq) && cwq.act !== 'block')) { /* 착지할 때까지 기다린다 */ } else if (cwq) { if (H.bRoll == null) H.bRoll = Math.random(); if (H.bRoll < ({ easy: 0.3, normal: 0.45, hard: 0.55, hell: 0.65 }[aiD(S)] || 0.45)) { const tx = netD(0, 58), tz = B.z, dx = tx - cwq.x, dz = tz - cwq.z; let i = 0; if (dx > 12) i |= K.R; else if (dx < -12) i |= K.L; if (dz > 10) i |= K.D; else if (dz < -10) i |= K.U; if (cwq.gnd && H.t - H.t0 < 0.24) i = K.S; else if (!cwq.gnd) i = cwq.act === 'idle' && (S.tick & 1) ? K.S : 0; cwq.inp = i; } }
  for (const q of S.players) { if (q === cwq && H.bRoll < 0.7) continue; if (!q.bot || q.ko || busy(q)) continue;
    { const m = B.mets.find(o => !o.hit && o.t < 0.95 && Math.hypot(q.x - o.x, (q.z - o.z) * 1.3) < 95 * XS); if (m && Math.random() < ({ easy: 0.5, normal: 0.7, hard: 0.85, hell: 0.95 }[aiD(S)] || 0.7)) { let i = 0; if (q.x >= m.x) i |= K.R; else i |= K.L; if (q.z >= m.z) i |= K.D; else i |= K.U; q.inp = i; continue; } } // 운석 피하기
    if (B.sweep && B.sweep.warn <= 0 && q.gnd && q.x - B.sweep.x > -10 && q.x - B.sweep.x < 95 * XS && Math.random() < ({ easy: 0.55, normal: 0.75, hard: 0.88, hell: 0.95 }[aiD(S)] || 0.75)) { q.inp = K.S; continue; }
    if (!free) continue;
    const go = (x, z, jump) => { const dx = x - q.x, dz = z - q.z; let i = 0; if (dx > 14) i |= K.R; else if (dx < -14) i |= K.L; if (dz > 10) i |= K.D; else if (dz < -10) i |= K.U; if (jump && Math.hypot(dx, dz) < 70 * XS && q.gnd) i |= K.S; q.inp = i; };
    const r = B.rats.filter(o => !o.dead).sort((a, c) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(c.x - q.x, c.z - q.z))[0];
    if (r) { go(r.x + r.vx * 0.35, r.z + r.vz * 0.35, true); continue; }
    if (B.shield && q.bcol !== B.shield.col) { const pd = bossPads(S).find(p2 => p2[2] === B.shield.col); go(pd[0], pd[1], false); }
  }
}
function bossEvBots(S) { const E = S.boss.ev; for (const q of S.players) if (q.bot) { q.inp = 0; if (E && E.k === 'seize' && !E.done && E.t >= q.jt && q.gnd && !q.ko && q.st.down <= 0) { q.inp = K.S; q.jt = 99; } } }
function bossSuperHit(S, p, sup) { // 상대에게 거는 필살기는 보스에게: 잠깐 그로기 + 데미지
  const B = S.boss; ev(S, 'txt', B.x, GY - 440, B.z, { puppet: '보스 해킹!', float: '보스가 둥둥~', wrap: '보스 꽁꽁 포장!', half: '보스 능력 반띵!', snore: '보스 쿨쿨…' }[sup] || '명중!', 1, 1);
  if (B.imm && !B.exh) { ev(S, 'txt', B.x, GY - 400, B.z, '무적이라 안 통해!', 0); return; }
  B.groggy = Math.max(B.groggy, 3.5); bossSt(B, 'groggy'); const d = 260; B.hp = Math.max(B.done.rage ? 0 : B.hpMax * 0.01, B.hp - d); ev(S, 'bossDmg', B.x, GY - 300, B.z, d, 2);
}
function bossParry(S, p) { // 10 카운터: 번쩍일 때 막으면 보스 코트로 튕겨낸다
  const B = S.boss, b = S.ball; drive(S, b, oppD(0, rnd(250, 470)), rnd(80, ZD - 80), GY - BR, 1550); b.parry = true; b.power = true; b.lastTeam = 0; b.lastP = p.i;
  B.cwSer = -1; B.groggy = Math.max(B.groggy, 2.5); bossSt(B, 'flinch'); ev(S, 'bossParry', b.x, b.y, b.z, p.i); ev(S, 'txt', p.x, p.y - 200, p.z, '카운터!!', 1, 1); S.stopT = 0.2;
}

const Core = { BOSSES, bossPads, CHAL, ROLES, roleOf, askDouble, predMove, rollDope, dopeLabel, chOf, DOPE_T, SCAT, CATN, BEATS, shotPreview, spikeAim, drill, forceSup, noTouch, CTRLS, COURTS, useCourt, court: () => ({ CW, NETX, ZD, XS, VW }), W, H, GY, NETH, NETW, BR, NETTOP, DT, K, CHARS, STAGES, ITEMS, DIFFS, HOMES, newGame, step, predict, psc, fdir, busy, jumpH, netD, oppD, sideOf, clamp, rnd, heat };
if (typeof module !== 'undefined') module.exports = Core;
