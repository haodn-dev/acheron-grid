export function installTooltips(root: HTMLElement): () => void {
    const doc = root.ownerDocument;
    const tip = doc.createElement('div');
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    tip.style.cssText = 'position:fixed;z-index:10000;pointer-events:none;max-width:min(280px,calc(100vw - 16px));box-sizing:border-box;overflow-wrap:anywhere;line-height:1.45;padding:7px 10px;border:1px solid var(--acheron-grid-line-color);border-radius:7px;background:var(--acheron-header-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 3px 12px #0003';
    root.append(tip);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = '';
    let pointer = {x:0,y:0};
    const position = () => {
        const bounds = tip.getBoundingClientRect();
        const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight;
        tip.style.left = `${Math.max(8,Math.min(pointer.x + 12,width - bounds.width - 8))}px`;
        tip.style.top = `${Math.max(8,Math.min(pointer.y + 16,height - bounds.height - 8))}px`;
    };
    const hide = () => { clearTimeout(timer); tip.hidden = true; previous = ''; };
    const show = (event: PointerEvent) => {
        const element = event.target instanceof doc.defaultView!.HTMLElement ? event.target.closest<HTMLElement>('[title], [data-grid-tooltip]') : null;
        const text = element?.title || element?.dataset.gridTooltip || root.title;
        for (const target of [element, root]) if (target?.title) { if (target !== root) { target.dataset.gridTooltip = target.title; if (!target.hasAttribute('aria-description')) target.setAttribute('aria-description', target.title); } target.removeAttribute('title'); }
        if (!text) { hide(); return; }
        pointer = {x:event.clientX,y:event.clientY};
        if (!tip.hidden) position();
        if (text === previous) return;
        clearTimeout(timer); tip.hidden = true; previous = text;
        timer = setTimeout(() => { tip.textContent = text; tip.hidden = false; position(); }, 450);
    };
    root.addEventListener('pointermove', show);
    root.addEventListener('pointerleave', hide);
    root.addEventListener('pointerdown', hide);
    return () => {
        hide(); tip.remove();
        root.removeEventListener('pointermove', show); root.removeEventListener('pointerleave', hide); root.removeEventListener('pointerdown', hide);
    };
}
