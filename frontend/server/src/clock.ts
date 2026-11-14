import { SCENARIO_START } from './time.ts';

/**
 * 시연용 가상 시계. 실제 차 없이 45분 주행을 몇 분 안에 보여주려고
 * 배속(speed)을 바꿀 수 있다. 모든 서버 로직은 Date.now() 대신 이 시계를 쓴다.
 */
export class SimClock {
  now: number;
  speed: number;
  paused: boolean;

  constructor(start: number = SCENARIO_START, speed = 1) {
    this.now = start;
    this.speed = speed;
    this.paused = false;
  }

  /** 실제 경과 시간(ms)을 받아 가상 시간을 진행하고, 진행한 가상 ms를 돌려준다. */
  advance(realDtMs: number): number {
    if (this.paused) return 0;
    const dt = realDtMs * this.speed;
    this.now += dt;
    return dt;
  }

  reset(start: number = SCENARIO_START): void {
    this.now = start;
    this.speed = 1;
    this.paused = false;
  }
}
