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
import ToolQueryEditor from 'c/toolQueryEditor';
import getFieldOptions from '@salesforce/apex/ToolAuthoringController.getFieldOptions';
import searchStandardTargetSObjects from '@salesforce/apex/ToolAuthoringController.searchStandardTargetSObjects';
import getChildRelationshipOptions from '@salesforce/apex/ToolAuthoringController.getChildRelationshipOptions';

jest.mock('@salesforce/apex/ToolAuthoringController.getFieldOptions', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/ToolAuthoringController.searchStandardTargetSObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/ToolAuthoringController.getChildRelationshipOptions', () => ({ default: jest.fn() }), { virtual: true });

const CASE_FIELDS = [
    { value: 'AccountId', label: 'Account ID', dataType: 'REFERENCE', referenceTo: 'Account', relationshipName: 'Account' },
    { value: 'Status', label: 'Status', dataType: 'PICKLIST', isPicklist: true, picklistValues: [{ value: 'New', label: 'New' }] }
];

async function type(element, text) {
    const textarea = element.shadowRoot.querySelector('textarea');
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new CustomEvent('input'));
    await flush();
    return textarea;
}

function shownSuggestions(element) {
    return [...element.shadowRoot.querySelectorAll('[role="option"] .query-option-value')].map((node) => node.textContent);
}

async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
}

function createEditor() {
    return createElement('c-tool-query-editor', { is: ToolQueryEditor });
}

async function editAt(element, marked) {
    const caret = marked.indexOf('|');
    const textarea = await type(element, marked.replace('|', ''));
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new CustomEvent('click'));
    await flush();
    return textarea;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

describe('c-tool-query-editor', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('shows the query the page gives it', async () => {
        const element = createEditor();
        element.value = 'SELECT Name FROM Account WHERE Type = :type LIMIT 5';
        document.body.appendChild(element);
        await flush();

        expect(element.shadowRoot.querySelector('textarea').value).toBe('SELECT Name FROM Account WHERE Type = :type LIMIT 5');
    });

    it('tells the page the query on each edit, so the inputs follow it', async () => {
        const element = createEditor();
        const changed = jest.fn();
        element.addEventListener('querychange', changed);
        document.body.appendChild(element);
        await flush();
        expect(changed).not.toHaveBeenCalled();

        const textarea = element.shadowRoot.querySelector('textarea');
        textarea.value = 'SELECT Subject FROM Case WHERE Status IN :statuses LIMIT 10';
        textarea.dispatchEvent(new CustomEvent('input'));

        expect(changed).toHaveBeenCalledTimes(1);
        expect(changed.mock.calls[0][0].detail.value).toBe('SELECT Subject FROM Case WHERE Status IN :statuses LIMIT 10');
    });

    it('tells the parent when query editing starts and ends', async () => {
        const element = createEditor();
        const editing = jest.fn();
        element.addEventListener('queryeditingchange', editing);
        document.body.appendChild(element);
        await flush();
        const textarea = element.shadowRoot.querySelector('textarea');
        textarea.dispatchEvent(new FocusEvent('focus'));
        textarea.dispatchEvent(new FocusEvent('blur'));
        expect(editing.mock.calls.map(([event]) => event.detail.editing)).toEqual([true, false]);
    });

    describe('suggestions', () => {
        beforeEach(() => {
            getFieldOptions.mockImplementation(({ objectApiName }) => Promise.resolve(objectApiName === 'Case' ? CASE_FIELDS : []));
        });

        it('starts SELECT with Id and FROM, lists objects, and returns the caret after Id', async () => {
            searchStandardTargetSObjects.mockResolvedValue([{ value: 'Opportunity', label: 'Opportunity • Opportunity' }]);
            const element = createEditor();
            const changed = jest.fn();
            element.addEventListener('querychange', changed);
            document.body.appendChild(element);
            await flush();
            const textarea = element.shadowRoot.querySelector('textarea');
            textarea.focus();
            await flush();
            expect(shownSuggestions(element)).toEqual(['SELECT']);
            element.shadowRoot.querySelector('[role="option"]').dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
            expect(element.value).toBe('SELECT Id FROM ');
            expect(textarea.selectionStart).toBe('SELECT Id FROM '.length);
            await new Promise((resolve) => setTimeout(resolve, 280));
            await flush();
            expect(searchStandardTargetSObjects).toHaveBeenCalledWith({ term: '', operation: 'QueryRecords' });
            expect(shownSuggestions(element)).toEqual(['Opportunity']);
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('narrow the list');
            element.shadowRoot.querySelector('[role="option"]').dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
            expect(element.value).toBe('SELECT Id FROM Opportunity');
            expect(textarea.selectionStart).toBe('SELECT Id'.length);
            expect(textarea.selectionEnd).toBe('SELECT Id'.length);
            expect(element.shadowRoot.activeElement).toBe(textarea);
            expect(changed.mock.calls.map(([event]) => event.detail.value)).toEqual(['SELECT Id FROM ', 'SELECT Id FROM Opportunity']);
            textarea.value = 'SELECT Id,  FROM Opportunity';
            textarea.setSelectionRange(11, 11);
            textarea.dispatchEvent(new CustomEvent('input'));
            await flush();
            expect(getFieldOptions).toHaveBeenCalledWith({ objectApiName: 'Opportunity' });
        });

        it('accepts the sole object suggestion with Enter and returns the starter caret after Id', async () => {
            searchStandardTargetSObjects.mockResolvedValue([{ value: 'Opportunity', label: 'Opportunity' }]);
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SEL');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
            await type(element, 'SELECT Id FROM Opp');
            await new Promise((resolve) => setTimeout(resolve, 280));
            await flush();
            const option = element.shadowRoot.querySelector('[role="option"]');
            expect(option.getAttribute('aria-selected')).toBe('true');
            expect(option.classList.contains('slds-has-focus')).toBe(true);
            expect(textarea.getAttribute('aria-activedescendant')).toBe(option.id);
            const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            textarea.dispatchEvent(enter);
            expect(enter.defaultPrevented).toBe(true);
            expect(element.value).toBe('SELECT Id FROM Opportunity');
            expect(textarea.selectionStart).toBe(9);
        });

        it('does not move back after an object in a manually written query', async () => {
            searchStandardTargetSObjects.mockResolvedValue([{ value: 'Opportunity', label: 'Opportunity' }]);
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Name FROM Opp');
            await new Promise((resolve) => setTimeout(resolve, 280));
            await flush();
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            expect(element.value).toBe('SELECT Name FROM Opportunity ');
            expect(textarea.selectionStart).toBe(element.value.length);
        });

        it('offers fields of the FROM object, loads them once, and Tab inserts the highlighted one', async () => {
            const element = createEditor();
            const changed = jest.fn();
            element.addEventListener('querychange', changed);
            document.body.appendChild(element);
            await flush();

            const textarea = await type(element, 'SELECT Id FROM Case WHERE Acc');
            expect(shownSuggestions(element)).toEqual(['AccountId', 'Account.']);
            expect(textarea.getAttribute('aria-activedescendant')).toBeNull();

            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            await flush();
            expect(textarea.value).toBe('SELECT Id FROM Case WHERE AccountId ');
            expect(element.value.trim()).toBe('SELECT Id FROM Case WHERE AccountId');
            expect(changed).toHaveBeenCalledTimes(2);

            await type(element, 'SELECT Id FROM Case WHERE AccountId = ');
            expect(shownSuggestions(element)).toEqual([':anchorId', ':accountId', 'NULL']);
            expect(getFieldOptions).toHaveBeenCalledTimes(1);
        });

        it('opens the list under the word being typed, not under the query box', async () => {
            const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
            const offsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
            Object.defineProperty(HTMLSpanElement.prototype, 'offsetTop', { configurable: true, get: () => 60 });
            Object.defineProperty(HTMLSpanElement.prototype, 'offsetLeft', { configurable: true, get: () => 900 });
            try {
                const element = createEditor();
                document.body.appendChild(element);
                await flush();
                const textarea = element.shadowRoot.querySelector('textarea');
                textarea.style.lineHeight = '20px';
                textarea.style.borderWidth = '0px';
                Object.defineProperty(textarea, 'offsetHeight', { configurable: true, value: 200 });
                Object.defineProperty(textarea, 'offsetWidth', { configurable: true, value: 800 });
                await type(element, 'SELECT Id FROM Case WHERE Acc');

                const style = element.shadowRoot.querySelector('.query-suggestions').getAttribute('style');
                expect(style).toContain('top: 80px');
                expect(style).toContain('left: 416px');
            } finally {
                delete HTMLSpanElement.prototype.offsetTop;
                delete HTMLSpanElement.prototype.offsetLeft;
                Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
                Object.defineProperty(HTMLElement.prototype, 'offsetLeft', offsetLeft);
            }
        });

        it('requires arrow selection for Enter, leaves Shift+Enter for new lines, and Esc closes the list', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            await flush();
            let textarea = await type(element, 'SELECT Id FROM Case WHERE Status = ');

            const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
            textarea.dispatchEvent(shiftEnter);
            expect(shiftEnter.defaultPrevented).toBe(false);

            const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            textarea.dispatchEvent(enter);
            expect(enter.defaultPrevented).toBe(false);
            expect(textarea.value).toBe('SELECT Id FROM Case WHERE Status = ');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
            await flush();
            expect(textarea.value).toBe('SELECT Id FROM Case WHERE Status = :status ');

            textarea = await type(element, 'SELECT Id FROM Case WHERE Status = ');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
            await flush();
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
            await flush();
            expect(textarea.value).toBe('SELECT Id FROM Case WHERE Status = :status ');

            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
            await flush();
            expect(element.shadowRoot.querySelector('[role="listbox"]')).toBeNull();
        });

        it('searches objects after FROM once the admin pauses, asking only for Query Records objects', async () => {
            jest.useFakeTimers();
            try {
                searchStandardTargetSObjects.mockResolvedValue([{ value: 'Case', label: 'Case • Case' }]);
                const element = createEditor();
                document.body.appendChild(element);
                for (let tick = 0; tick < 5; tick++) {
                    await Promise.resolve();
                }
                const textarea = element.shadowRoot.querySelector('textarea');
                textarea.value = 'SELECT Id FROM Ca';
                textarea.dispatchEvent(new CustomEvent('input'));
                textarea.value = 'SELECT Id FROM Cas';
                textarea.dispatchEvent(new CustomEvent('input'));
                await Promise.resolve();
                jest.advanceTimersByTime(250);
                for (let tick = 0; tick < 5; tick++) {
                    await Promise.resolve();
                }

                expect(searchStandardTargetSObjects).toHaveBeenCalledTimes(1);
                expect(searchStandardTargetSObjects).toHaveBeenCalledWith({ term: 'Cas', operation: 'QueryRecords' });
                expect(shownSuggestions(element)).toEqual(['Case']);
            } finally {
                jest.useRealTimers();
            }
        });

        it('tells the admin when an object is unknown or they cannot read it, instead of listing its fields', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            await flush();
            await type(element, 'SELECT Id, Na FROM Secret__c');

            expect(shownSuggestions(element)).toEqual([]);
            const textarea = element.shadowRoot.querySelector('textarea');
            textarea.setSelectionRange(13, 13);
            textarea.dispatchEvent(new CustomEvent('click'));
            await flush();
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toBe(
                'Pluto cannot find the object Secret__c, or you cannot read it.'
            );
        });

        it('suggests child relationships and the child object fields inside a child subquery', async () => {
            getChildRelationshipOptions.mockResolvedValue([{ value: 'Cases', label: 'Case' }]);
            getFieldOptions.mockImplementation(({ objectApiName }) => Promise.resolve(objectApiName === 'Case' ? CASE_FIELDS : []));
            const element = createEditor();
            document.body.appendChild(element);
            await flush();

            const textarea = await type(element, 'SELECT Id, (SELECT Id FROM Ca) FROM Account');
            textarea.setSelectionRange(29, 29);
            textarea.dispatchEvent(new CustomEvent('click'));
            await flush();
            expect(shownSuggestions(element)).toEqual(['Cases']);
            expect(getChildRelationshipOptions).toHaveBeenCalledWith({ objectApiName: 'Account' });

            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            await flush();
            expect(textarea.value).toBe('SELECT Id, (SELECT Id FROM Cases) FROM Account');

            textarea.setSelectionRange(19, 19);
            textarea.dispatchEvent(new CustomEvent('click'));
            await flush();
            expect(shownSuggestions(element)).toEqual(expect.arrayContaining(['AccountId', 'Status']));
        });

        it('shows no suggestions while the editor is read-only', async () => {
            const element = createEditor();
            element.disabled = true;
            document.body.appendChild(element);
            await flush();
            await type(element, 'SELECT Id FROM Case WHERE ');

            expect(element.shadowRoot.querySelector('[role="listbox"]')).toBeNull();
            expect(getFieldOptions).not.toHaveBeenCalled();
        });

        it('replaces a whole field or selected word and preserves the following comma', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            let textarea = await editAt(element, 'SELECT Stat|us, Id FROM Case');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            await flush();
            expect(element.value).toBe('SELECT Status, Id FROM Case');

            textarea = await type(element, 'SELECT Wrong, Id FROM Case');
            textarea.setSelectionRange(7, 12);
            textarea.dispatchEvent(new CustomEvent('click'));
            await flush();
            element.shadowRoot.querySelector('[role="option"][data-index="0"]').dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
            expect(element.value).toBe('SELECT AccountId, Id FROM Case');
        });

        it('replaces a quoted value without duplicating its closing quote', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await editAt(element, "SELECT Id FROM Case WHERE Status = 'Ne|w' AND Id = :id");
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            expect(element.value).toBe("SELECT Id FROM Case WHERE Status = 'New' AND Id = :id");
        });

        it('replaces a bind suffix and avoids adding a second relationship dot', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            let textarea = await editAt(element, 'SELECT Id FROM Case WHERE Status = :sta|tus');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            expect(element.value.trim()).toBe('SELECT Id FROM Case WHERE Status = :status');
            textarea = await editAt(element, 'SELECT Acc|ount.Name FROM Case');
            const relationship = [...element.shadowRoot.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes('Account.'));
            relationship.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
            expect(element.value).toBe('SELECT Account.Name FROM Case');
        });

        it('keeps Shift+Tab for backward navigation without inserting a suggestion', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
            textarea.dispatchEvent(event);
            await flush();
            expect(event.defaultPrevented).toBe(false);
            expect(element.value).toBe('SELECT Id FROM Case WHERE Sta');
            expect(shownSuggestions(element)).toEqual([]);
        });

        it('selects a sole field suggestion for Enter and keeps Shift+Enter for a newline', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            expect(shownSuggestions(element)).toEqual(['Status']);
            expect(element.shadowRoot.querySelector('[role="option"]').getAttribute('aria-selected')).toBe('true');
            const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
            textarea.dispatchEvent(shiftEnter);
            expect(shiftEnter.defaultPrevented).toBe(false);
            const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            textarea.dispatchEvent(enter);
            expect(enter.defaultPrevented).toBe(true);
            expect(element.value).toBe('SELECT Id FROM Case WHERE Status ');
            await flush();
            expect(shownSuggestions(element)).toEqual(['=', '!=', 'IN', 'NOT IN']);
            expect(textarea.getAttribute('aria-activedescendant')).toBeNull();
            const nextEnter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            textarea.dispatchEvent(nextEnter);
            expect(nextEnter.defaultPrevented).toBe(false);
        });

        it('selects the option under the pointer, so Enter inserts it instead of starting a new line', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Status = ');
            const options = element.shadowRoot.querySelectorAll('[role="option"]');
            options[1].dispatchEvent(new MouseEvent('mousemove'));
            await flush();
            expect(options[1].getAttribute('aria-selected')).toBe('true');
            expect(options[0].getAttribute('aria-selected')).toBe('false');
            expect(element.shadowRoot.querySelector('[aria-live]').textContent).toBe("'New', 2 of 3");
            const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            textarea.dispatchEvent(enter);
            expect(enter.defaultPrevented).toBe(true);
            expect(element.value).toBe("SELECT Id FROM Case WHERE Status = 'New' ");
        });

        it('keeps Enter for a new line when the only suggestion follows a finished word', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id, Status ');
            expect(shownSuggestions(element)).toEqual(['FROM']);
            expect(element.shadowRoot.querySelector('[role="option"]').getAttribute('aria-selected')).toBe('false');
            const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
            textarea.dispatchEvent(enter);
            expect(enter.defaultPrevented).toBe(false);
            expect(element.value).toBe('SELECT Id, Status ');
        });

        it('leaves Enter with Ctrl, Cmd, or Alt to the page', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
                const enter = new KeyboardEvent('keydown', { key: 'Enter', [modifier]: true, cancelable: true });
                textarea.dispatchEvent(enter);
                expect(enter.defaultPrevented).toBe(false);
            }
            expect(element.value).toBe('SELECT Id FROM Case WHERE Sta');
        });

        it('replaces a partial operator without keeping its prefix', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Status !');
            expect(shownSuggestions(element)).toEqual(['!=']);
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            expect(element.value).toBe('SELECT Id FROM Case WHERE Status != ');
        });

        it('explains unmatched fields and unknown relationship paths', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            await type(element, 'SELECT Id FROM Case WHERE Missing');
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('No matching readable fields');
            await editAt(element, 'SELECT Missing.Na| FROM Case');
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('relationship Missing');
            expect(element.shadowRoot.querySelector('[data-query-retry]')).toBeNull();
        });

        it('retries from the button while keeping query editing active', async () => {
            getFieldOptions.mockRejectedValueOnce(new Error('Temporary failure'));
            const element = createEditor();
            const editing = jest.fn();
            element.addEventListener('queryeditingchange', editing);
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            const retry = element.shadowRoot.querySelector('[data-query-retry]');
            expect(retry).not.toBeNull();
            const down = new MouseEvent('mousedown', { cancelable: true });
            retry.dispatchEvent(down);
            expect(down.defaultPrevented).toBe(true);
            textarea.dispatchEvent(new FocusEvent('blur', { relatedTarget: retry }));
            expect(editing).not.toHaveBeenCalled();
            retry.click();
            await flush();
            expect(shownSuggestions(element)).toEqual(['Status']);
            expect(element.shadowRoot.querySelector('[data-query-retry]')).toBeNull();
            expect(getFieldOptions).toHaveBeenCalledTimes(2);
        });

        it('does not offer fields or Retry when metadata access is refused', async () => {
            getFieldOptions.mockResolvedValue([]);
            const element = createEditor();
            document.body.appendChild(element);
            await type(element, 'SELECT Id FROM Secret__c WHERE Missing');
            expect(shownSuggestions(element)).toEqual([]);
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('or you cannot read it');
            expect(element.shadowRoot.querySelector('[data-query-retry]')).toBeNull();
        });

        it('shows a failed field request and lets Ctrl+Space retry it', async () => {
            getFieldOptions.mockRejectedValueOnce(new Error('Private server error'));
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('Could not load fields for Case');
            expect(element.shadowRoot.textContent).not.toContain('Private server error');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, cancelable: true }));
            await flush();
            expect(shownSuggestions(element)).toEqual(['Status']);
            expect(getFieldOptions).toHaveBeenCalledTimes(2);
        });

        it('keeps an inaccessible object empty on retry without offering its fields', async () => {
            getFieldOptions.mockResolvedValue([]);
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Secret__c WHERE ');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, cancelable: true }));
            await flush();
            expect(shownSuggestions(element)).toEqual([]);
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('or you cannot read it');
            expect(getFieldOptions).toHaveBeenCalledTimes(1);
        });

        it('retries failed child relationship requests without caching the failure', async () => {
            getChildRelationshipOptions.mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce([{ value: 'Cases', label: 'Case' }]);
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await editAt(element, 'SELECT Id, (SELECT Id FROM Ca|) FROM Account');
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('Could not load child relationships for Account');
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, cancelable: true }));
            await flush();
            expect(shownSuggestions(element)).toEqual(['Cases']);
            expect(getChildRelationshipOptions).toHaveBeenCalledTimes(2);
        });

        it('shares a pending field request and uses only the latest typed prefix', async () => {
            const request = deferred();
            getFieldOptions.mockReturnValue(request.promise);
            const element = createEditor();
            document.body.appendChild(element);
            await type(element, 'SELECT Id FROM Case WHERE S');
            await type(element, 'SELECT Id FROM Case WHERE Sta');
            expect(getFieldOptions).toHaveBeenCalledTimes(1);
            expect(shownSuggestions(element)).toEqual([]);
            request.resolve(CASE_FIELDS);
            await flush();
            expect(shownSuggestions(element)).toEqual(['Status']);
        });

        it('clears previous suggestions while loading another object', async () => {
            const request = deferred();
            const element = createEditor();
            document.body.appendChild(element);
            await type(element, 'SELECT Id FROM Case WHERE Acc');
            expect(shownSuggestions(element)).toContain('AccountId');
            getFieldOptions.mockReturnValue(request.promise);
            const textarea = await type(element, 'SELECT Id FROM Account WHERE Na');
            expect(shownSuggestions(element)).toEqual([]);
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            expect(element.value).toBe('SELECT Id FROM Account WHERE Na');
            textarea.dispatchEvent(new CustomEvent('blur'));
            request.resolve([{ value: 'Name', label: 'Name', dataType: 'STRING' }]);
            await flush();
            expect(element.shadowRoot.querySelector('[role="listbox"]')).toBeNull();
        });

        it('refuses insertion when the caret moved without refreshing suggestions', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            textarea.setSelectionRange(0, 0);
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
            expect(element.value).toBe('SELECT Id FROM Case WHERE Sta');
            await flush();
            expect(shownSuggestions(element)).toEqual([]);
        });

        it('discards a delayed response after the parent replaces the query or disables the editor', async () => {
            for (const transition of ['replace', 'disable', 'remove']) {
                const request = deferred();
                getFieldOptions.mockReturnValue(request.promise);
                const element = createEditor();
                document.body.appendChild(element);
                await type(element, 'SELECT Id FROM Case WHERE Sta');
                if (transition === 'replace') element.value = 'SELECT Id FROM Account';
                if (transition === 'disable') element.disabled = true;
                if (transition === 'remove') element.remove();
                request.resolve(CASE_FIELDS);
                await flush();
                if (transition === 'remove') document.body.appendChild(element);
                await flush();
                expect(element.shadowRoot.querySelector('[role="listbox"]')).toBeNull();
                element.remove();
            }
        });

        it('closes an open list when disabled and ignores suggestion keyboard shortcuts', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            const textarea = await type(element, 'SELECT Id FROM Case WHERE Sta');
            element.disabled = true;
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
            await flush();
            expect(element.value).toBe('SELECT Id FROM Case WHERE Sta');
            expect(shownSuggestions(element)).toEqual([]);
        });

        it('distinguishes a failed object search from no matching accessible objects', async () => {
            const element = createEditor();
            document.body.appendChild(element);
            searchStandardTargetSObjects.mockRejectedValueOnce(new Error('Do not show this error'));
            const textarea = await type(element, 'SELECT Id FROM Cas');
            await new Promise((resolve) => setTimeout(resolve, 270));
            await flush();
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toContain('Could not search objects');
            searchStandardTargetSObjects.mockResolvedValueOnce([]);
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, 270));
            await flush();
            expect(element.shadowRoot.querySelector('.query-suggestion-message').textContent).toBe('No matching objects you can query.');
        });
    });
});
