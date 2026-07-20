// Official club resale services, surveyed 2026-07-20 from operator domains.
// `access` is the practical barrier for a visitor without a Japanese phone or
// address — the clubs themselves document none of this, so it is inferred from
// the signup requirements each service publishes.
export const OFFICIAL_RESALE = {
  giants: {
    name: 'GIANTS公式リセール', platform: 'チケプラTrade',
    url: 'https://tradead.tixplus.jp/giants/',
    cap: '購入価格 + 구매자 수수료 10%(최소 ¥550)',
    opens: '일반권은 경기 3일 전부터', type: '전자(앱 전용)',
    access: 'hard', note: 'GIANTS ID + SMS 인증, 앱 전용 수령',
  },
  hanshintigers: { none: true, note: '공식 리셀 없음 — 구단이 리셀 자체를 경고' },
  baystars: {
    name: 'ベイチケリセール', platform: '자체 / チケプラTrade(종이)',
    url: 'https://ticket.baystars.co.jp/app/web/contents/resale.html',
    cap: '購入価格 +¥500 (¥1만 미만) 또는 ×105%',
    opens: '경기 20일 전 10:00 → 당일 08:59', type: '전자(자체) / 종이(チケプラ)',
    access: 'hard', note: 'DeNA 계정 + SMS 인증 필요',
  },
  carp: { none: true, note: '공식 리셀 없음, 취소도 불가 — 한번 사면 못 뺀다' },
  'yakult-swallows': {
    name: 'スワチケ公式リセール', platform: '자체 / チケプラTrade',
    url: 'https://ticket.yakult-swallows.co.jp/contents/pages/resale.html',
    cap: '정가 이하 (구매가가 상한)',
    opens: '일반발매 후 → 전날 23:59', type: 'QR(자체) / 종이(チケプラ)',
    access: 'ok', note: '무료 스왈로즈ID + 카드 3D시큐어 필요',
  },
  dragons: {
    name: 'ドラゴンズ公認リセール', platform: 'チケプラTrade',
    url: 'https://tradead.tixplus.jp/dragons',
    cap: '購入価格 ~ +10% (정가 초과를 허용하는 유일한 구단)',
    opens: '시리즈 개막 1개월 전 → 경기 4일 전 16:00', type: 'QR',
    access: 'hard', note: 'チケプラ ID + 본인 단말 SMS 인증',
  },
  softbankhawks: {
    name: 'タカチケット公式リセール', platform: '자체',
    url: 'https://myticket.softbankhawks.co.jp/hqr/ResaleRemarks.aspx',
    cap: '판매자가 가격 설정 불가 — 구단이 일반판매가로 재판매',
    opens: '회원선행 발매일 → 전날 23:59', type: '전자',
    access: 'ok', note: '무료 타카포인트 회원이면 가능, 앱 필요',
  },
  marines: {
    name: '公式チケットリセール', platform: 'チケット流通センター',
    url: 'https://www.ticket.co.jp/marines/',
    cap: '정가 + 수수료 (이익 없음)',
    opens: '일반발매 무렵 → 경기 직전', type: '전자 + 종이',
    access: 'easy', note: '무료 チケ流 계정만 — 구단 회원가입 불필요',
  },
  seibulions: {
    name: '西武公式リセール', platform: '자체 / チケット流通センター',
    url: 'https://www.seibulions.jp/ticket/resale/',
    cap: '자체: 購入価格 +¥380 / チケ流: 券面 + 수수료',
    opens: '일반판매일 09:00 → 당일 08:59', type: '전자 / 양쪽',
    access: 'easy', note: '무료 계정이면 어느 쪽이든 가능',
  },
  rakuteneagles: {
    name: 'みんなのチケット', platform: '楽天NFT마켓플레이스',
    url: 'https://www.rakuteneagles.jp/ticket/resale/',
    cap: '상한 없음 — 2025년 9월부터 자유 가격',
    opens: '일반판매 후 → 경기 2일 전', type: '전자',
    access: 'hard', note: '楽天ID + SMS, 일본 주소·전화 전제',
  },
  buffaloes: {
    name: '公式チケットリセール', platform: 'チケット流通センター',
    url: 'https://www.ticket.co.jp/buffaloes/',
    cap: '券面 + 수수료 (정확한 상한 비공개, 출품 시 강제)',
    opens: '리셀 개시일 → 경기 시작 1시간 전', type: '전자 + 종이',
    access: 'easy', note: '무료 チケ流 계정, 디지털 티켓으로 필터링할 것',
  },
  fighters: {
    name: 'ファイターズ公式リセール', platform: '자체 Fチケ / チケ流',
    url: 'https://www.fighters.co.jp/expansion/fticket/resale/',
    cap: '±¥1,000 범위 (공개 페이지가 옛 삿포로돔 기준이라 불확실)',
    opens: '일반발매일 → 당일 13:59', type: '전자 / 양쪽',
    access: 'easy', note: '구매는 전원 가능, 판매만 회원 필요',
  },
};

/** The home club decides which official resale applies to a game. */
export function officialFor(teams = []) {
  for (const t of teams) {
    const o = OFFICIAL_RESALE[t];
    if (o) return { team: t, ...o };
  }
  return null;
}
