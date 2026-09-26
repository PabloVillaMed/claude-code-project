// Máquina de estados de la historia (sin DOM ni three.js: se prueba sola).
// Un capítulo es una lista de pasos (ver CHAPTER_1 en storyLines.js):
//   mission  termina cuando se cumple la misión `mission` (dador en `poi`)
//   money    termina cuando el jugador junta `chapter.rent`
//   talk     termina al hablar (E) en `poi` con la plata; si no alcanza, avisa
// update() y talk() devuelven eventos que ejecuta el juego:
//   {type:'objective', text, poi} · {type:'line', id} · {type:'pay', amount}
//   {type:'chapterEnd', chapter}

export class StorySystem {
  constructor(chapter) {
    this.chapter = chapter;
    this.step = -1; // -1 = sin empezar (antes de la cinemática)
    this.done = false;
    this._shown = null;
  }

  get current() {
    return this.step >= 0 && !this.done ? this.chapter.steps[this.step] : null;
  }

  start() {
    this.step = 0;
    this.done = false;
    this._shown = null;
  }

  /** Texto del objetivo actual (con el avance de la plata). */
  objectiveText(money) {
    const st = this.current;
    if (!st) return '';
    if (st.kind === 'money') return `${st.text} ($${Math.min(money, this.chapter.rent).toLocaleString('es-CO')} / $${this.chapter.rent.toLocaleString('es-CO')})`;
    return st.text;
  }

  /** ctx = {completed: Set de misiones cumplidas, money} */
  update(ctx) {
    const events = [];
    for (let guard = 0; guard < 4; guard++) {
      const st = this.current;
      if (!st) break;
      if (st.kind === 'mission' && ctx.completed.has(st.mission)) this.step++;
      else if (st.kind === 'money' && ctx.money >= this.chapter.rent) this.step++;
      else if (st.kind === 'talk' && ctx.money < this.chapter.rent && this.step > 0 && this.chapter.steps[this.step - 1].kind === 'money') this.step--;
      else break;
    }
    const st = this.current;
    const text = this.objectiveText(ctx.money);
    if (st && text !== this._shown) {
      this._shown = text;
      events.push({ type: 'objective', text, poi: st.poi ?? null, hint: st.hint ?? null });
    }
    return events;
  }

  /** El jugador presiona E en un lugar. Devuelve eventos (vacío si no es de la historia). */
  talk(poiId, money) {
    const st = this.current;
    if (!st || st.kind !== 'talk' || st.poi !== poiId) return [];
    if (money < this.chapter.rent) return [{ type: 'line', id: 'rosa-falta' }];
    this.done = true;
    this.step = this.chapter.steps.length;
    return [
      { type: 'pay', amount: this.chapter.rent },
      { type: 'chapterEnd', chapter: this.chapter },
    ];
  }

  serialize() {
    return { chapter: this.chapter.id, step: this.step, done: this.done };
  }

  restore(data) {
    if (!data || data.chapter !== this.chapter.id) return;
    this.step = Math.max(-1, Math.min(this.chapter.steps.length, data.step ?? -1));
    this.done = !!data.done;
    this._shown = null;
  }
}
