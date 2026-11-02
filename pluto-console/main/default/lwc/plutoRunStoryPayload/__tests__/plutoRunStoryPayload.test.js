/*
 * This file is part of Pluto. It is licensed under the GNU Affero General
 * Public License, version 3 only. See the LICENSE file at the root of this
 * repository, or https://www.gnu.org/licenses/agpl-3.0.html.
 *
 * The Pluto Extension Exception in the LICENSE-EXCEPTION file lets code that
 * uses only Pluto's public interface stay under its own license.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Copyright (c) 2026 Sonal
 */

import { createElement } from 'lwc';
import PlutoRunStoryPayload from 'c/plutoRunStoryPayload';

function render(value) {
    const element = createElement('c-pluto-run-story-payload', { is: PlutoRunStoryPayload });
    element.label = 'Final answer';
    element.value = value;
    document.body.appendChild(element);
    return element;
}

describe('c-pluto-run-story-payload', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    it('renders text that is not JSON as Markdown', () => {
        const markdown = '## Done\n\n- Closed the case.';
        const element = render(markdown);
        const viewer = element.shadowRoot.querySelector('c-markdown-viewer');

        expect(viewer.value).toBe(markdown);
        expect(element.shadowRoot.querySelector('pre.json')).toBeNull();
    });

    it('keeps JSON colour-coded', () => {
        const element = render('{"summary":"Done"}');

        expect(element.shadowRoot.querySelector('c-markdown-viewer')).toBeNull();
        expect(element.shadowRoot.querySelector('pre.json .json-key').textContent).toBe('"summary":');
        expect(element.shadowRoot.querySelector('pre.json .json-string').textContent).toBe('"Done"');
    });
});
