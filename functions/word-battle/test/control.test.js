'use strict';
const assert = require('assert'); const { isBattleOpen } = require('../control'); let n = 0; const t = (m, f) => { f(); n++; console.log('  ✓', m); };
t('설정이 없으면 열려 있음', () => { assert(isBattleOpen(null, 'B1', 'student').open); assert(isBattleOpen({}, 'B1', 'student').open); });
t('전체를 닫으면 모든 지점 학생이 막힘', () => { assert(!isBattleOpen({ all: false }, 'B1', 'student').open); assert(!isBattleOpen({ all: false, branches: { B1: true } }, 'B1', 'student').open); });
t('지점만 닫으면 그 지점만 막힘', () => { const c = { branches: { B1: false } }; assert(!isBattleOpen(c, 'B1', 'student').open); assert(isBattleOpen(c, 'B2', 'student').open); });
t('다시 열면 가능 (all:true, 지점:true)', () => { assert(isBattleOpen({ all: true, branches: { B1: true } }, 'B1', 'student').open); });
t('본원 관리자는 닫혀 있어도 시험할 수 있음', () => { assert(isBattleOpen({ all: false }, null, 'super').open); });
t('지점 정보가 없는 학생도 전체 닫힘에는 막힘', () => { assert(!isBattleOpen({ all: false }, null, 'student').open); assert(isBattleOpen({ branches: { B1: false } }, null, 'student').open); });
console.log(`\n통과 ${n}개`);
