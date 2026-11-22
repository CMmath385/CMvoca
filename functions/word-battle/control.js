'use strict';
/* WORD BATTLE 열기·닫기 (순수 함수)
   설정 문서 wb_settings/control = { all: true|false, branches: { [지점uid]: true|false } }
   - 설정이 없으면 열려 있음. 본원이 전체를 닫거나 지점 선생님이 자기 지점을 닫으면 그 학생들은 새 방 만들기·들어가기를 못 한다.
   - 이미 시작한 경기는 끝까지 한다. 본원 관리자(시험용)는 닫혀 있어도 쓸 수 있다. */
function isBattleOpen(control, branchId, role) {
  if (role === 'super') return { open: true };
  const c = control || {};
  if (c.all === false) return { open: false, by: 'all', message: '지금은 배틀이 닫혀 있어요. 선생님이 열면 할 수 있어요.' };
  if (c.branches && branchId && c.branches[branchId] === false) return { open: false, by: 'branch', message: '지금은 배틀이 닫혀 있어요. 선생님이 열면 할 수 있어요.' };
  return { open: true };
}
module.exports = { isBattleOpen };
