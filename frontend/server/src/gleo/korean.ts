/** 한국어 표현 도우미: 조사, 수량, 금액 */

function hasBatchim(word: string): { has: boolean; rieul: boolean } {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) {
    // 한글이 아니면(숫자·영문) 받침 없음으로 본다. 단 숫자는 읽는 소리 기준으로 대략 처리
    if (/[136780]$/.test(ch)) return { has: true, rieul: /[178]$/.test(ch) };
    return { has: false, rieul: false };
  }
  const jong = code % 28;
  return { has: jong !== 0, rieul: jong === 8 };
}

type Josa = '로' | '을' | '이' | '은' | '와' | '이에요';

/** 받침에 맞춰 조사를 붙인다: josa('청양마요', '로') → '청양마요로' */
export function josa(word: string, j: Josa): string {
  const { has, rieul } = hasBatchim(word);
  switch (j) {
    case '로':
      return word + (has && !rieul ? '으로' : '로');
    case '을':
      return word + (has ? '을' : '를');
    case '이':
      return word + (has ? '이' : '가');
    case '은':
      return word + (has ? '은' : '는');
    case '와':
      return word + (has ? '과' : '와');
    case '이에요':
      return word + (has ? '이에요' : '예요');
  }
}

const NATIVE = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
export function qtyWord(n: number): string {
  return NATIVE[n] ?? String(n);
}

export function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

const KOR_NUM: Record<string, number> = {
  한: 1, 하나: 1, 일: 1,
  두: 2, 둘: 2, 이: 2,
  세: 3, 셋: 3, 삼: 3,
  네: 4, 넷: 4, 사: 4,
  다섯: 5, 오: 5,
};

/** "두 마리", "2개", "하나 더" 같은 수량 표현. 없으면 null */
export function parseQty(text: string): number | null {
  const m = text.match(/(\d+|다섯|하나|한|두|둘|세|셋|네|넷)\s*(마리|개|판|잔|인분|줄|세트)/);
  if (m) return /^\d+$/.test(m[1]) ? Number(m[1]) : KOR_NUM[m[1]] ?? null;
  const m2 = text.match(/(?:^|\s)(하나|둘|셋|넷|다섯)(?:\s|$|만|요)/);
  if (m2) return KOR_NUM[m2[1]];
  return null;
}

/** 비교용 정규화: 공백·문장부호 제거, 소문자 */
export function norm(text: string): string {
  return text.toLowerCase().replace(/[\s.,!?~'"“”‘’()·\-]/g, '');
}
