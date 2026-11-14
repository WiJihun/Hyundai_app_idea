import { findCard } from './world.ts';

/**
 * 결제 어댑터. 인카페이먼트 API가 공개되지 않아 모의 결제로 구현한다(11/14 결정).
 * 연동이 허용되면 PaymentProvider를 구현한 어댑터만 바꿔 끼운다.
 * 카드번호 전체는 앱·서버에 저장하지 않고, 화면 표시용 카드 끝 4자리만 다룬다.
 */
export interface PaymentRequest {
  orderId: string;
  amount: number;
  /** 인카페이먼트에 등록된 카드 id (없으면 기본 카드) */
  cardId?: string;
  merchant?: string;
}

export interface CardInfo {
  issuer: string;
  name: string;
  last4: string;
}

export type PaymentResult =
  | { ok: true; provider: string; approvalNo: string; amount: number; card: CardInfo; installment: string }
  | { ok: false; provider: string; reason: string };

export interface PaymentProvider {
  readonly name: string;
  charge(req: PaymentRequest): Promise<PaymentResult>;
  refund(approvalNo: string, amount: number): Promise<{ ok: boolean }>;
}

export class MockInCarPayment implements PaymentProvider {
  readonly name = 'mock-incar-payment';
  /** 데모 패널에서 켜면 다음 결제 1건이 실패한다 */
  failNext = false;
  private seq = 0;

  async charge(req: PaymentRequest): Promise<PaymentResult> {
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, provider: this.name, reason: '카드 승인 거절(모의)' };
    }
    if (!Number.isInteger(req.amount) || req.amount <= 0) {
      return { ok: false, provider: this.name, reason: '잘못된 금액' };
    }
    const c = findCard(req.cardId);
    this.seq += 1;
    return {
      ok: true,
      provider: this.name,
      approvalNo: `MOCK-${String(this.seq).padStart(6, '0')}`,
      amount: req.amount,
      card: { issuer: c.issuer, name: c.name, last4: c.last4 },
      installment: '일시불',
    };
  }

  async refund(_approvalNo: string, _amount: number): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
