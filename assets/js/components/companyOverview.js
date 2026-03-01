(() => {
  const { el, clear } = window.DartDOM;
  const { cardRoot, cardHeader, cardBody } = window.DartCard;
  const DataLoader = window.DartDataLoader;
  const State = window.DartState;

  // ── 시장 구분 (DART corp_cls) ─────────────────────────────────────
  const CORP_CLS_MAP = {
    Y: 'KOSPI',
    K: 'KOSDAQ',
    N: 'KONEX',
    E: '비상장',
  };

  // ── 한국표준산업분류(KSIC) 업종코드 → 업종명 ──────────────────────
  // DART company.json의 induty_code(3자리 기준)를 사람이 읽을 수 있는 이름으로 변환.
  const KSIC_MAP = {
    101: '도축·육류 가공업', 102: '수산물 가공업', 103: '과실·채소 가공업',
    105: '낙농제품 제조업', 106: '곡물·전분제품 제조업', 107: '기타 식품 제조업',
    108: '동물용 사료 제조업', 110: '음료 제조업', 120: '담배 제조업',
    131: '방적·가공사 제조업', 132: '직물 제조업', 139: '기타 섬유제품 제조업',
    141: '봉제의복 제조업', 149: '기타 의복·액세서리 제조업',
    151: '가죽·가방 제조업', 152: '신발 제조업',
    161: '제재·목재 가공업', 170: '펄프·종이·판지 제조업',
    181: '인쇄업', 191: '석유정제품 제조업',
    201: '기초화학물질 제조업', 202: '비료·농약 제조업',
    203: '합성고무·플라스틱 제조업', 204: '기타 화학제품 제조업',
    205: '화학섬유 제조업', 206: '의약품 제조업', 207: '의료용 물질·의약품 제조업',
    211: '기초화학물질 제조업', 221: '고무제품 제조업', 222: '플라스틱제품 제조업',
    231: '유리제품 제조업', 232: '도자기·요업 제조업', 239: '기타 비금속광물 제조업',
    241: '제1차 철강 제조업', 242: '제1차 비철금속 제조업',
    251: '구조용 금속제품 제조업', 252: '무기·총포 제조업', 259: '기타 금속가공제품 제조업',
    261: '전자부품 제조업', 262: '컴퓨터·주변기기 제조업',
    263: '통신·방송장비 제조업', 264: '반도체 및 기타 전자부품 제조업',
    265: '의료·정밀·광학기기 제조업',
    271: '전동기·발전기·전기변환장치 제조업', 272: '전지 제조업',
    273: '절연선·케이블 제조업', 274: '조명장치 제조업',
    275: '가정용 기기 제조업', 279: '기타 전기장비 제조업',
    281: '일반 목적용 기계 제조업', 282: '특수 목적용 기계 제조업',
    291: '자동차 제조업', 292: '자동차 차체·트레일러 제조업', 293: '자동차 부품 제조업',
    301: '선박·보트 건조업', 302: '철도장비 제조업', 303: '항공기·우주선 제조업',
    311: '가구 제조업', 321: '귀금속·장신구 제조업', 329: '기타 제품 제조업',
    351: '전기업', 352: '가스 제조·배관공급업', 360: '수도업',
    381: '금속·비금속 원료 재생업', 390: '환경정화·복원업',
    410: '종합건설업', 421: '건물건설업', 422: '토목건설업', 429: '기타 전문건설업',
    451: '자동차 판매업', 452: '자동차 부품·용품 판매업',
    461: '상품 도매업', 462: '산업용 농·축·수산물 도매업',
    471: '종합 소매업', 472: '음식료품 위주 소매업', 478: '통신판매업',
    491: '철도 운송업', 492: '육상 화물 운송업', 493: '파이프라인 운송업',
    511: '해상 운송업', 521: '항공 여객 운송업', 522: '항공 화물 운송업',
    531: '보관 및 창고업', 541: '화물 취급업', 551: '여관업', 552: '호텔업',
    561: '음식점업', 571: '주점업',
    581: '출판업', 591: '영화·비디오물·방송프로그램 제작업',
    601: '라디오 방송업', 602: '텔레비전 방송업',
    611: '전기통신업', 612: '유선 통신업', 613: '무선 통신업', 619: '기타 통신업',
    620: '컴퓨터 프로그래밍·시스템 통합 및 관리업',
    631: '자료처리·호스팅·포털 및 인터넷 정보 매개 서비스업',
    639: '기타 정보 서비스업',
    641: '은행 및 저축기관', 642: '지주회사 및 경영컨설팅업',
    643: '신탁업 및 집합투자업', 649: '기타 금융업',
    651: '보험업', 652: '재보험업', 659: '기타 보험관련 서비스업',
    661: '보험업', 665: '금융 지원 서비스업',
    701: '부동산 개발·공급업', 702: '부동산 관련 서비스업',
    711: '건물 임대업', 712: '부동산 관리업',
    721: '연구개발업', 722: '전문 디자인업', 729: '기타 전문서비스업',
    731: '연구개발업', 741: '광고업', 742: '시장·여론조사업',
    749: '기타 전문·과학·기술 서비스업',
    751: '건물 및 산업설비 청소업', 761: '인력 공급·고용알선업',
    781: '여행사 및 관광버스 운영업',
    911: '공공행정',
  };

  function resolveIndutyName(indutyCode) {
    if (!indutyCode) return null;
    const code = String(indutyCode).trim();
    // 정확 매핑 우선, 없으면 앞 3자리로 재시도
    return KSIC_MAP[code] || KSIC_MAP[Number(code)] || KSIC_MAP[Number(code.slice(0, 3))] || null;
  }

  function formatDate(raw) {
    if (!raw) return '-';
    const s = String(raw).replace(/[^0-9]/g, '');
    if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return raw;
  }

  function formatAccMt(raw) {
    if (!raw) return '-';
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? `${n}월` : String(raw);
  }

  function formatMarket(corpCls, fallback) {
    return CORP_CLS_MAP[String(corpCls || '').trim().toUpperCase()] || fallback || '-';
  }

  // ── 최대주주 관계 → 임원 강조 매핑 ────────────────────────────────
  // 주주의 relation 값을 기준으로 임원 항목 강조 색상 결정
  const REL_TIER1 = ['최대주주', '특수관계', '본인'];
  const REL_TIER2 = [
    '배우자',
    '직계존속', '직계비속',
    '조부', '조모', '외조부', '외조모',
    '손자', '손녀', '외손자', '외손녀',
  ];
  const REL_TIER2_SINGLE = ['자', '녀', '부', '모'];
  const REL_TIER3 = [
    '형제자매', '형', '제', '누나', '언니',
    '삼촌', '숙부', '숙모', '고모', '이모', '외삼촌',
    '조카', '생질', '사위', '며느리', '제수', '동서',
    '장인', '장모', '처부', '시부', '시모',
    '혈족', '인척', '친인척',
  ];

  function getRelationClass(relation) {
    if (!relation) return '';
    const r = relation.trim();
    if (REL_TIER1.some((k) => r.includes(k))) return 'rel-tier1';
    if (REL_TIER2.some((k) => r.includes(k))) return 'rel-tier2';
    if (REL_TIER2_SINGLE.some((k) => new RegExp(`(^|[\\s(])${k}([\\s)]|$)`).test(r))) return 'rel-tier2';
    if (REL_TIER3.some((k) => r.includes(k))) return 'rel-tier3';
    return '';
  }

  // ── 수집 상태 플레이스홀더 ──────────────────────────────────────────
  const SYNC_STATUS_CONFIG = {
    collecting:  { icon: '⏳', label: '수집 중...', hint: '잠시 후 자동으로 갱신됩니다.' },
    refreshing:  { icon: '🔄', label: '갱신 중...', hint: '새로운 데이터를 수집하고 있습니다.' },
    no_data:     { icon: 'ℹ️', label: 'DART 공시 데이터 없음', hint: '해당 기간 공시가 제출되지 않았습니다.' },
    error:       { icon: '⚠️', label: '수집 오류', hint: '데이터 재수집 버튼을 눌러 다시 시도해 주세요.' },
    never_synced: { icon: '—', label: '미수집', hint: '데이터 재수집 버튼을 눌러 수집을 시작하세요.' },
  };

  function renderSyncStatusBlock(sectionTitle, statusKey) {
    const cfg = SYNC_STATUS_CONFIG[statusKey] || SYNC_STATUS_CONFIG.never_synced;
    const wrap = el('div', { className: 'sync-status-section' });
    wrap.appendChild(el('h4', { className: 'sync-status-section__title', text: sectionTitle }));
    const msg = el('div', { className: `sync-status-msg sync-status--${statusKey}` });
    msg.appendChild(el('span', { className: 'sync-status-msg__icon', text: cfg.icon }));
    const body = el('span', { className: 'sync-status-msg__body' });
    body.appendChild(el('span', { className: 'sync-status-msg__label', text: cfg.label }));
    body.appendChild(el('span', { className: 'sync-status-msg__hint', text: cfg.hint }));
    msg.appendChild(body);
    wrap.appendChild(msg);
    return wrap;
  }

  function resolveStatus(data, collecting) {
    const hasItems = Array.isArray(data?.items) && data.items.length > 0;
    if (collecting && !hasItems) return 'collecting';   // 수집 중 + 데이터 없음 → 스피너
    if (collecting && hasItems)  return 'refreshing';   // 수집 중 + 기존 데이터 있음 → 갱신 배지
    if (!data) return 'never_synced';
    if (!hasItems) {
      const s = data.sync_status;
      if (s === 'error') return 'error';
      return 'no_data';
    }
    return 'ok';
  }

  function renderRefreshingBadge() {
    const cfg = SYNC_STATUS_CONFIG.refreshing;
    const badge = el('div', { className: 'sync-refreshing-badge' });
    badge.appendChild(el('span', { className: 'sync-refreshing-badge__icon', text: cfg.icon }));
    badge.appendChild(el('span', { className: 'sync-refreshing-badge__label', text: cfg.label }));
    return badge;
  }

  function renderShareholders(shareholders, collecting) {
    const status = resolveStatus(shareholders, collecting);
    if (status !== 'ok' && status !== 'refreshing') return renderSyncStatusBlock('최대주주 현황', status);

    const top = shareholders.items.slice(0, 3);
    const total = shareholders.items.reduce((s, it) => s + (it.ratio || 0), 0);
    const others = Math.max(0, Math.round((total - top.reduce((s, it) => s + (it.ratio || 0), 0)) * 100) / 100);
    const othersCount = shareholders.items.length - top.length;


    const wrap = el('div', { className: 'shareholders-section' });
    const titleRow = el('div', { className: 'section-title-row' });
    titleRow.appendChild(el('h4', { className: 'shareholders-title', text: `최대주주 현황` + (shareholders.bsns_year ? ` (${shareholders.bsns_year}년)` : '') }));
    if (status === 'refreshing') titleRow.appendChild(renderRefreshingBadge());
    wrap.appendChild(titleRow);

    const list = el('ul', { className: 'shareholders-list' });
    for (const item of top) {
      const li = el('li', { className: 'shareholders-item' });

      const head = el('div', { className: 'shareholders-item__head' });
      const nameEl = el('span', { className: 'shareholders-item__name', text: item.nm });
      const ratioEl = el('span', { className: 'shareholders-item__ratio', text: `${item.ratio.toFixed(2)}%` });
      head.appendChild(nameEl);
      if (item.relation) head.appendChild(el('span', { className: 'shareholders-item__rel', text: item.relation }));
      head.appendChild(ratioEl);

      const bar = el('div', { className: 'shareholders-bar' });
      const fill = el('div', { className: 'shareholders-bar__fill' });
      fill.style.width = `${Math.min(100, item.ratio).toFixed(1)}%`;
      bar.appendChild(fill);

      li.appendChild(head);
      li.appendChild(bar);
      list.appendChild(li);
    }

    if (othersCount > 0) {
      const footer = el('div', { className: 'shareholders-footer', text: `외 ${othersCount}명 합계 ${others.toFixed(2)}%` });
      wrap.appendChild(list);
      wrap.appendChild(footer);
    } else {
      wrap.appendChild(list);
    }

    // 자사주 비율
    const treasury = shareholders.common_treasury_shares;
    const issued   = shareholders.total_issued_shares;
    if (treasury != null && issued != null && issued > 0) {
      const ratio = (treasury / issued) * 100;

      const li = el('li', { className: 'shareholders-item shareholders-item--treasury' });

      const head = el('div', { className: 'shareholders-item__head' });
      head.appendChild(el('span', { className: 'shareholders-item__name', text: '자사주' }));
      head.appendChild(el('span', { className: 'shareholders-item__rel', text: `${treasury.toLocaleString()}주 / ${issued.toLocaleString()}주` }));
      head.appendChild(el('span', { className: 'shareholders-item__ratio', text: `${ratio.toFixed(2)}%` }));

      const bar  = el('div', { className: 'shareholders-bar' });
      const fill = el('div', { className: 'shareholders-bar__fill shareholders-treasury__fill' });
      fill.style.width = `${Math.min(100, ratio).toFixed(1)}%`;
      bar.appendChild(fill);

      li.appendChild(head);
      li.appendChild(bar);
      list.appendChild(li);
    }

    // 네이버 보조 주주 (기관투자자 등 DART 외 주주)
    const naverExtra = Array.isArray(shareholders.naver_extra_items)
      ? shareholders.naver_extra_items
      : [];
    if (naverExtra.length > 0) {
      const divider = el('li', { className: 'shareholders-divider' });
      divider.appendChild(el('span', { className: 'shareholders-divider__label', text: '기타 주요주주 (네이버)' }));
      list.appendChild(divider);

      for (const item of naverExtra) {
        const li = el('li', { className: 'shareholders-item shareholders-item--naver' });

        const head = el('div', { className: 'shareholders-item__head' });
        head.appendChild(el('span', { className: 'shareholders-item__name', text: item.nm }));
        if (item.shares) {
          head.appendChild(el('span', { className: 'shareholders-item__rel', text: `${Number(item.shares).toLocaleString()}주` }));
        }
        head.appendChild(el('span', { className: 'shareholders-item__ratio', text: `${Number(item.ratio).toFixed(2)}%` }));

        const bar  = el('div', { className: 'shareholders-bar' });
        const fill = el('div', { className: 'shareholders-bar__fill shareholders-naver__fill' });
        fill.style.width = `${Math.min(100, Number(item.ratio)).toFixed(1)}%`;
        bar.appendChild(fill);

        li.appendChild(head);
        li.appendChild(bar);
        list.appendChild(li);
      }
    }

    return wrap;
  }

  const REPRT_CODE_LABEL = {
    '11011': '사업보고서',
    '11012': '반기보고서',
    '11013': '1분기보고서',
    '11014': '3분기보고서',
  };

  // ── 학력 하이라이트 ─────────────────────────────────────────────────
  const EDU_PATTERNS = [
    // 국내 대학교 / 대학원 (단과대 약칭 포함)
    /[가-힣a-zA-Z]+(?:대학교|대학원|사범대|의과대학|법과대학|단과대학|대학|대(?=[^\S\r\n]|졸|입|$))/gm,
    // 해외 대학/대학원 (영문, "University of X" / "X University" 모두 대응)
    /\b(?:University|Univ\.?|College|Institute|School)\b(?:\s+of\s+[A-Za-z][A-Za-z&.'-]*){0,6}/i,
    /\b[A-Za-z][A-Za-z&.'-]*(?:\s+[A-Za-z][A-Za-z&.'-]*){0,8}\s+(?:University|Univ\.?|College|Institute|School)\b/i,
    // 특수대학 약칭 (KAIST 등 — '대학교'로 끝나지 않음)
    /(?:KAIST|POSTECH|GIST|UNIST|DGIST|카이스트|포스텍)/gi,
    // 학과 / 전공
    /[가-힣]+(?:학부|학과|전공|과(?=[^\S\r\n]|졸|$))/gm,
    // 단과대 약칭 (공대, 법대, 의대 등)
    /[가-힣]+(?:공대|법대|의대|상대|문대|사대|경대)/g,
    // 고등학교
    /[가-힣]+(?:고등학교|고교|고(?=[^\S\r\n]|졸|$))/gm,
    // 학위 / 수료 상태
    /(?:Ph\.?D\.?|MBA|EMBA|AMP|석사|박사|학사|졸업|수료|중퇴)/g,
    // 최고위과정 (임원 경력에 빈번)
    /[가-힣]*(?:최고위과정|최고경영자과정|경영자과정)/g,
  ];

  const EDU_EN_INSTITUTION_TOKEN = /\b(?:university|univ\.?|college|institute|school)\b/i;
  const EDU_EN_DEGREE_TOKEN = /\b(?:b\.?\s?a\.?|b\.?\s?s\.?|m\.?\s?a\.?|m\.?\s?s\.?|mba|emba|ph\.?\s?d\.?|ll\.?\s?m\.?|j\.?\s?d\.?|bachelor(?:'s)?|master(?:'s)?|doctor(?:ate)?|degree|major|graduat(?:e|ed)|undergraduate|graduate)\b/i;
  const EDU_EN_CONTEXT_TOKEN = /\b(?:school of|graduate school|business school|college of|institute of)\b/i;
  const EDU_EN_ORG_NOISE = /\b(?:relations|team|office|division|department|planning|strategy)\b/i;
  const EDU_EN_PROPER_NOUN_SCHOOL = /\b(?:[A-Za-z][A-Za-z&.'-]*\s+){0,8}(?:University|Univ\.?|College|Institute|School)\b(?:\s+of\s+[A-Za-z][A-Za-z&.'-]*){0,6}/i;

  function normalizeEduLine(line) {
    return String(line || '')
      .replace(/[·•\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasEnglishEducationContext(line) {
    const normalized = normalizeEduLine(line);
    if (!normalized) return false;
    const lower = normalized.toLowerCase();

    const hasDegree = EDU_EN_DEGREE_TOKEN.test(lower);
    if (hasDegree) return true;

    const hasInstitution = EDU_EN_INSTITUTION_TOKEN.test(lower) || EDU_EN_CONTEXT_TOKEN.test(lower);
    if (!hasInstitution) return false;

    const hasSchoolName = EDU_EN_PROPER_NOUN_SCHOOL.test(normalized);

    // "University Relations Team" 같은 조직명 오탐은 제외
    if (EDU_EN_ORG_NOISE.test(lower) && !hasDegree && !hasSchoolName) return false;

    return hasDegree || hasSchoolName || EDU_EN_CONTEXT_TOKEN.test(lower);
  }

  function lineHasEdu(line) {
    for (const pat of EDU_PATTERNS) {
      pat.lastIndex = 0;
      if (pat.test(line)) return true;
    }
    return hasEnglishEducationContext(line);
  }

  function highlightEducation(text) {
    const lines = text.split('\n');
    let anyMatch = false;
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      if (lineHasEdu(line)) {
        anyMatch = true;
        const mark = document.createElement('mark');
        mark.className = 'career-edu-highlight';
        mark.textContent = line;
        frag.appendChild(mark);
      } else {
        frag.appendChild(document.createTextNode(line));
      }
      if (i < lines.length - 1) frag.appendChild(document.createTextNode('\n'));
    });
    return anyMatch ? frag : null;
  }

  function formatBirthYm(raw) {
    if (!raw) return null;
    const s = String(raw).replace(/[^0-9]/g, '');
    if (s.length >= 6) return `${s.slice(0, 4)}년 ${parseInt(s.slice(4, 6), 10)}월생`;
    return raw;
  }

  function renderOfficers(officers, marketCap, collecting) {
    const status = resolveStatus(officers, collecting);
    if (status !== 'ok' && status !== 'refreshing') return renderSyncStatusBlock('임원 현황', status);

    const label = REPRT_CODE_LABEL[officers.reprt_code] || '';
    const title = '임원 현황' + (officers.bsns_year ? ` (${officers.bsns_year}년${label ? ' ' + label : ''})` : '');

    // 시총 2000억 초과이면 기본 접힘, 이하이면 기본 펼침
    const CAP_THRESHOLD = 200_000_000_000;
    const cap = marketCap != null ? Number(marketCap) : null;
    const defaultOpen = cap == null || cap <= CAP_THRESHOLD;

    const wrap = el('details', { className: 'officers-section' });
    if (defaultOpen) wrap.setAttribute('open', '');
    const summaryEl = el('div', { className: 'officers-title-row' });
    summaryEl.appendChild(el('span', { className: 'officers-title__text', text: title }));
    if (status === 'refreshing') summaryEl.appendChild(renderRefreshingBadge());
    const summary = el('summary', { className: 'officers-title' });
    summary.appendChild(summaryEl);
    wrap.appendChild(summary);

    const content = el('div', { className: 'officers-content' });
    const list = el('ul', { className: 'officers-list' });
    for (const item of officers.items) {
      const hasRelation = !!getRelationClass(item.mxmm_shrholdr_relate || '');
      const li = el('li', { className: `officers-item${hasRelation ? ' officers-item--related' : ''}` });

      // 이름 + 직위 + 등기여부 + 상근여부
      const nameRow = el('div', { className: 'officers-item__name-row' });
      nameRow.appendChild(el('span', { className: 'officers-item__name', text: item.nm || '-' }));
      if (item.ofcps) nameRow.appendChild(el('span', { className: 'officers-item__pos', text: item.ofcps }));
      if (item.rgist_exctv_at) nameRow.appendChild(el('span', { className: 'officers-item__badge', text: item.rgist_exctv_at }));
      if (item.fte_at) nameRow.appendChild(el('span', { className: 'officers-item__badge officers-item__badge--sub', text: item.fte_at }));
      li.appendChild(nameRow);

      // 담당업무
      if (item.chrg_job && item.chrg_job !== '-') {
        li.appendChild(el('div', { className: 'officers-item__job', text: item.chrg_job }));
      }

      // 주요경력 (학력 키워드 노란 하이라이트)
      if (item.main_career && item.main_career !== '-') {
        const careerEl = el('div', { className: 'officers-item__career' });
        const highlighted = highlightEducation(item.main_career);
        if (highlighted) {
          careerEl.appendChild(highlighted);
        } else {
          careerEl.textContent = item.main_career;
        }
        li.appendChild(careerEl);
      }

      // 메타 정보 (출생년월, 성별, 최대주주관계, 재직기간, 임기만료일)
      const metas = [];
      const birth = formatBirthYm(item.birth_ym);
      if (birth) metas.push({ label: '생년', value: birth });
      if (item.sexdstn && item.sexdstn !== '-') metas.push({ label: '성별', value: item.sexdstn });
      if (item.mxmm_shrholdr_relate && item.mxmm_shrholdr_relate !== '-') metas.push({ label: '최대주주관계', value: item.mxmm_shrholdr_relate });
      if (item.hffc_pd && item.hffc_pd !== '-') metas.push({ label: '재직기간', value: item.hffc_pd });
      if (item.tenure_end_on && item.tenure_end_on !== '-') metas.push({ label: '임기만료', value: item.tenure_end_on });

      if (metas.length > 0) {
        const metaRow = el('div', { className: 'officers-item__meta' });
        for (const m of metas) {
          const chip = el('span', { className: 'officers-item__meta-chip' });
          chip.appendChild(el('span', { className: 'officers-item__meta-label', text: m.label }));
          chip.appendChild(el('span', { className: 'officers-item__meta-value', text: m.value }));
          metaRow.appendChild(chip);
        }
        li.appendChild(metaRow);
      }

      list.appendChild(li);
    }
    content.appendChild(list);
    wrap.appendChild(content);
    return wrap;
  }

  async function renderOverview(root, corp, prefetchedOverview, shareholders, officers, marketData, opts = {}) {
    clear(root);
    if (!corp) {
      root.appendChild(
        el('div', {
          className: 'empty-state card',
          children: [
            el('h2', { text: '기업을 선택해 주세요' }),
            el('p', { text: '상단 검색 바에서 상장사를 검색해 선택하면, 개황 · 재무 · 배당 정보를 보여드립니다.' }),
          ],
        }),
      );
      return;
    }

    let overview = prefetchedOverview || null;
    if (!overview) {
      try {
        overview = await DataLoader.getCorpOverview(corp.corp_code || corp.code);
      } catch (e) {
        overview = null;
      }
    }
    if (overview && overview.last_updated_at) {
      State.setLastUpdatedAt(overview.last_updated_at);
    }

    const baseCard = cardRoot('overview-card');
    baseCard.appendChild(cardHeader(corp.corp_name || corp.name || '-', '기업 개황'));

    const indutyName = resolveIndutyName(overview?.induty_code);

    const listDt = formatDate(overview?.list_dt);

    // 항목 정의: { label, value, full(전체너비 여부) }
    const kvItems = [
      { label: '종목코드', value: overview?.stock_code || corp.stock_code || '-' },
      { label: '시장',     value: formatMarket(overview?.corp_cls, overview?.market || corp.market) },
      { label: '업종',     value: indutyName || overview?.induty || corp.induty || corp.sector || '-' },
      { label: '결산월',   value: formatAccMt(overview?.acc_mt) },
      { label: '대표자',   value: overview?.ceo_nm || '-' },
      { label: '설립일',   value: formatDate(overview?.est_dt) },
      ...(listDt && listDt !== '-' ? [{ label: '상장일', value: listDt }] : []),
      { label: '주소',     value: overview?.adres || '-', full: true },
      { label: '홈페이지', value: overview?.hm_url || '-', full: true },
    ];

    const dl = el('dl', { className: 'overview-kv' });
    for (const item of kvItems) {
      const div = el('div', { className: 'overview-kv__item' + (item.full ? ' overview-kv__item--full' : '') });
      div.appendChild(el('dt', { text: item.label }));
      div.appendChild(el('dd', { text: item.value }));
      dl.appendChild(div);
    }

    // table 변수는 이하 cardBody에서 사용하므로 이름 유지
    const table = dl;

    const collecting = !!opts.collecting;
    const marketCap = marketData?.market_cap != null ? Number(marketData.market_cap) : null;
    const shareholdersEl = renderShareholders(shareholders, collecting);
    const officersEl     = renderOfficers(officers, marketCap, collecting);

    const bodyChildren = [table];
    // 항상 표시 (status placeholder 포함)
    bodyChildren.push(el('hr', { className: 'overview-divider' }));
    bodyChildren.push(shareholdersEl);
    bodyChildren.push(el('hr', { className: 'overview-divider' }));
    bodyChildren.push(officersEl);

    baseCard.appendChild(cardBody(bodyChildren));

    root.appendChild(baseCard);
  }

  window.DartCompanyOverview = { render: renderOverview };
})();

