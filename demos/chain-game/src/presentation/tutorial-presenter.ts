import type { TutorialView } from '../application/tutorial';
import './tutorial.css';

interface TutorialCallbacks {
  skip: () => void;
  continue: () => void;
}

/** A stable HUD slot: guidance never replaces controls during a pointer gesture. */
export class TutorialPresenter {
  private readonly card = document.createElement('aside');
  private readonly step = document.createElement('span');
  private readonly title = document.createElement('h2');
  private readonly body = document.createElement('p');
  private readonly detail = document.createElement('p');
  private readonly action = document.createElement('button');
  private readonly skip = document.createElement('button');
  private readonly announcement = document.createElement('span');
  private readonly lifecycle = new AbortController();
  private lastView: TutorialView | null = null;
  private announcedId: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    callbacks: TutorialCallbacks,
  ) {
    this.card.className = 'tutorial-card';
    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-label', '新手引导');
    this.card.hidden = true;
    this.step.className = 'tutorial-step';
    this.title.className = 'tutorial-title';
    this.body.className = 'tutorial-body';
    this.detail.className = 'tutorial-detail';
    this.action.className = 'tutorial-continue';
    this.skip.className = 'tutorial-skip';
    this.action.type = this.skip.type = 'button';
    this.skip.textContent = '跳过引导';
    this.announcement.className = 'sr-only';
    this.announcement.setAttribute('aria-live', 'polite');
    this.announcement.setAttribute('aria-atomic', 'true');
    const copy = document.createElement('div');
    copy.className = 'tutorial-copy';
    copy.append(this.step, this.title, this.body, this.detail);
    const actions = document.createElement('div');
    actions.className = 'tutorial-actions';
    actions.append(this.action, this.skip);
    this.card.append(copy, actions, this.announcement);
    this.action.addEventListener('click', () => callbacks.continue(), {
      signal: this.lifecycle.signal,
    });
    this.skip.addEventListener('click', () => callbacks.skip(), {
      signal: this.lifecycle.signal,
    });
    host.append(this.card);
  }

  render(view: TutorialView | null, busy: boolean, dragging: boolean): void {
    // The committed run can advance before its animation has finished. Keep
    // the current layout reserved until the visible action reaches that state.
    const visible = busy ? (this.lastView ?? view) : view;
    this.lastView = visible;
    this.card.hidden = visible === null;
    this.host.classList.toggle('has-tutorial', visible !== null);
    this.card.classList.toggle('is-busy', busy);
    if (!visible) {
      delete this.host.dataset.tutorialFocus;
      this.announcedId = null;
      this.announcement.textContent = '';
      return;
    }
    this.host.dataset.tutorialFocus = busy ? '' : visible.focus;
    this.step.textContent = `新手引导 ${visible.step} / ${visible.total}`;
    this.title.textContent = visible.title;
    this.body.textContent = visible.body;
    this.detail.textContent = busy
      ? '正在沿路线行动，稍等片刻…'
      : visible.detail;
    this.detail.hidden = !busy && !visible.detail;
    this.action.hidden = visible.action === null;
    this.action.textContent = visible.action ?? '';
    this.action.disabled = this.skip.disabled = busy || dragging;
    this.card.setAttribute('aria-busy', String(busy));
    if (!busy && visible.id !== this.announcedId) {
      this.announcedId = visible.id;
      this.announcement.textContent = `${visible.title}。${visible.body}`;
    }
  }

  dispose(): void {
    this.lifecycle.abort();
    this.card.remove();
    this.host.classList.remove('has-tutorial');
    delete this.host.dataset.tutorialFocus;
    this.lastView = null;
  }
}
