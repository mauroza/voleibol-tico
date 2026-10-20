/** Pantalla de sala online: el código grande para dictarlo o copiarlo, y el estado de la conexión. */
export function showLobby(root: HTMLElement): { show: (text: string, code: string) => void; fail: (text: string) => void; close: () => void } {
  const el = document.createElement('div');
  el.className = 'overlay lobby';
  const box = document.createElement('div');
  box.className = 'overlay-box';
  const title = document.createElement('h2');
  title.textContent = 'Sala online';
  const code = document.createElement('div');
  code.className = 'lobby-code';
  const copy = document.createElement('button');
  copy.textContent = 'Copiar código';
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(code.textContent ?? '').then(
      () => (copy.textContent = '¡Copiado!'),
      () => window.getSelection()?.selectAllChildren(code),
    );
  });
  const status = document.createElement('p');
  status.className = 'lobby-status';
  const back = document.createElement('button');
  back.textContent = 'Volver al menú';
  back.addEventListener('click', () => location.reload());
  const actions = document.createElement('div');
  actions.className = 'overlay-actions';
  actions.append(copy, back);
  box.append(title, code, status, actions);
  el.append(box);
  root.append(el);
  return {
    show: (text, c) => {
      if (c) code.textContent = c;
      copy.style.display = c ? '' : 'none';
      status.textContent = text;
    },
    fail: (text) => {
      status.textContent = text;
      status.classList.add('error');
    },
    close: () => el.remove(),
  };
}
