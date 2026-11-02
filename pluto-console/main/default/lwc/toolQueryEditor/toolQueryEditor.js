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

import { LightningElement, api } from 'lwc';
import getFieldOptions from '@salesforce/apex/ToolAuthoringController.getFieldOptions';
import getChildRelationshipOptions from '@salesforce/apex/ToolAuthoringController.getChildRelationshipOptions';
import searchStandardTargetSObjects from '@salesforce/apex/ToolAuthoringController.searchStandardTargetSObjects';
import { QUERY_TOOL_TYPE, readQueryContext, suggest } from './queryAssist';

const OBJECT_SEARCH_DELAY = 250;
const SUGGESTION_WIDTH = 384;
const MIRRORED_STYLES = [
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderStyle',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'wordSpacing',
    'tabSize',
    'textIndent'
];

/**
 * The query of a Query Records tool. Core reads the query and builds one
 * input for each :name, so the page refreshes the inputs whenever it
 * changes. Controlled: the parent passes value and gets each edit in a
 * querychange event.
 */
export default class ToolQueryEditor extends LightningElement {
    @api label = 'SOQL Query';
    @api required = false;

    query = '';

    suggestions = [];
    suggestionMessage = '';
    suggestionStyle = '';
    activeIndex = -1;
    canRetry = false;
    _starterPrefix = null;
    _replaceFrom = 0;
    _replaceTo = 0;
    _suggestVersion = 0;
    _fieldsByObject = new Map();
    _childrenByObject = new Map();
    _objectSearchTimer = null;
    _disabled = false;
    _suggestionContext = null;
    _pendingDescribes = new Map();

    @api
    get disabled() {
        return this._disabled;
    }

    set disabled(next) {
        this._disabled = Boolean(next);
        if (this._disabled) {
            this.closeSuggestions();
        }
    }

    @api
    get value() {
        return this.query;
    }

    set value(next) {
        const text = next === null || next === undefined ? '' : String(next);
        if (text !== this.query) {
            this.closeSuggestions();
            this.query = text;
            this._starterPrefix = null;
        }
    }

    disconnectedCallback() {
        this.closeSuggestions();
    }

    notifyChange() {
        this.dispatchEvent(new CustomEvent('querychange', { detail: { value: this.query } }));
    }

    /** A native textarea has no value attribute; set its text only when it differs, so typing keeps the cursor. */
    renderedCallback() {
        const textarea = this.textarea;
        if (textarea && textarea.value !== this.query) {
            textarea.value = this.query;
        }
    }

    get textarea() {
        return this.template.querySelector('textarea');
    }

    get showSuggestions() {
        return this.suggestions.length > 0 || !!this.suggestionMessage;
    }

    get suggestionOptions() {
        return this.suggestions.map((item, index) => ({
            ...item,
            index,
            id: `query-option-${index}`,
            ariaSelected: index === this.activeIndex ? 'true' : 'false',
            className:
                index === this.activeIndex
                    ? 'slds-media slds-listbox__option slds-listbox__option_entity slds-has-focus'
                    : 'slds-media slds-listbox__option slds-listbox__option_entity'
        }));
    }

    get activeOptionId() {
        return this.activeIndex >= 0 && this.suggestions.length ? `query-option-${this.activeIndex}` : null;
    }

    get suggestionStatus() {
        if (!this.suggestions.length) {
            return this.suggestionMessage;
        }
        const active = this.suggestions[this.activeIndex];
        if (active) {
            return `${active.label}, ${this.activeIndex + 1} of ${this.suggestions.length}`;
        }
        return this.suggestions.length === 1 ? '1 suggestion' : `${this.suggestions.length} suggestions`;
    }

    handleQueryInput(event) {
        this.query = event.target.value;
        if (this._starterPrefix && !this.query.startsWith(this._starterPrefix)) {
            this._starterPrefix = null;
        }
        this.notifyChange();
        this.refreshSuggestions();
    }

    handleCaretMove(event) {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key) && !this.matchesContext(this._suggestionContext)) {
            this.refreshSuggestions();
        }
    }

    handleQueryClick() {
        this.refreshSuggestions();
    }

    handleQueryFocus() {
        if (!this.query.trim()) {
            this.refreshSuggestions();
        }
        this.dispatchEvent(new CustomEvent('queryeditingchange', { detail: { editing: true } }));
    }

    handleQueryBlur(event) {
        if (event?.relatedTarget && event.relatedTarget === this.template.querySelector('[data-query-retry]')) {
            return;
        }
        this.closeSuggestions();
        this.dispatchEvent(new CustomEvent('queryeditingchange', { detail: { editing: false } }));
    }

    handleRetryMouseDown(event) {
        event.preventDefault();
    }

    handleRetry() {
        this.textarea?.focus();
        this.refreshSuggestions();
    }

    handleRetryBlur(event) {
        if (event.relatedTarget !== this.textarea) {
            this.handleQueryBlur(event);
        }
    }

    handleQueryScroll() {
        if (this.showSuggestions) {
            this.suggestionStyle = this.styleAtCaret(this._replaceFrom);
        }
    }

    /**
     * Places the list under the word being typed. A textarea does not say
     * where its caret is, so a hidden copy with the same font, padding, and
     * width lays out the text before it and reports where it ends.
     */
    styleAtCaret(index) {
        const textarea = this.textarea;
        const mirror = this.template.querySelector('.query-mirror');
        if (!textarea || !mirror) {
            return '';
        }
        const style = window.getComputedStyle(textarea);
        MIRRORED_STYLES.forEach((property) => {
            mirror.style[property] = style[property];
        });
        const pixels = (value) => parseFloat(value) || 0;
        mirror.style.boxSizing = 'content-box';
        mirror.style.width = `${Math.max(0, textarea.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight))}px`;
        mirror.textContent = this.query.slice(0, index);
        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        mirror.appendChild(marker);
        const lineHeight = pixels(style.lineHeight) || pixels(style.fontSize) * 1.5;
        const caretTop = pixels(style.borderTopWidth) + marker.offsetTop - textarea.scrollTop;
        const top = Math.min(Math.max(caretTop, 0), Math.max(0, textarea.offsetHeight - lineHeight)) + lineHeight;
        const left = Math.max(0, Math.min(pixels(style.borderLeftWidth) + marker.offsetLeft - textarea.scrollLeft, textarea.offsetWidth - SUGGESTION_WIDTH));
        mirror.textContent = '';
        return `top: ${Math.round(top)}px; left: ${Math.round(left)}px;`;
    }

    handleQueryKeydown(event) {
        if (this.disabled || event.isComposing) {
            return;
        }
        if (event.key === 'Tab' && event.shiftKey) {
            this.closeSuggestions();
            return;
        }
        if (event.key === ' ' && event.ctrlKey) {
            event.preventDefault();
            this.refreshSuggestions();
            return;
        }
        if (!this.suggestions.length) {
            if (event.key === 'Escape' && this.suggestionMessage) {
                event.stopPropagation();
                this.closeSuggestions();
            }
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.activeIndex =
                this.activeIndex < 0
                    ? step === 1
                        ? 0
                        : this.suggestions.length - 1
                    : (this.activeIndex + step + this.suggestions.length) % this.suggestions.length;
            this.template.querySelector(`[data-index="${this.activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
        } else if (
            event.key === 'Tab' ||
            (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && this.activeIndex >= 0)
        ) {
            event.preventDefault();
            this.insertSuggestion(Math.max(0, this.activeIndex));
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.closeSuggestions();
        }
    }

    /** Selects the option under the pointer, so Enter inserts the option that looks selected. */
    handleOptionMouseMove(event) {
        const index = Number(event.currentTarget.dataset.index);
        if (index !== this.activeIndex) {
            this.activeIndex = index;
        }
    }

    /** Keeps focus in the query box, so the click does not close the list first. */
    handleOptionMouseDown(event) {
        event.preventDefault();
        this.insertSuggestion(Number(event.currentTarget.dataset.index));
    }

    insertSuggestion(index) {
        const item = this.suggestions[index];
        const textarea = this.textarea;
        if (!item || !this.matchesContext(this._suggestionContext)) {
            this.closeSuggestions();
            return;
        }
        let after = this.query.slice(this._replaceTo);
        if (item.value.endsWith('.') && after.startsWith('.')) {
            after = after.slice(1);
        }
        const returnToFields = item.objectOption && this._starterPrefix && this.query.slice(0, this._replaceFrom) === this._starterPrefix && !after.trim();
        const value = item.insertValue || item.value;
        const spacer = returnToFields || value.endsWith('.') || value.endsWith(' ') || /^[\s),]/.test(after) ? '' : ' ';
        const inserted = value + spacer;
        this.query = this.query.slice(0, this._replaceFrom) + inserted + after;
        textarea.focus();
        textarea.value = this.query;
        const caret = returnToFields ? this._starterPrefix.indexOf('Id') + 2 : this._replaceFrom + inserted.length;
        this._starterPrefix = item.insertValue ? this.query : null;
        textarea.setSelectionRange(caret, caret);
        this.notifyChange();
        if (returnToFields) {
            this.closeSuggestions();
        } else {
            this.refreshSuggestions();
        }
    }

    closeSuggestions() {
        this._suggestVersion++;
        clearTimeout(this._objectSearchTimer);
        this.suggestions = [];
        this.suggestionMessage = '';
        this.canRetry = false;
        this.activeIndex = -1;
        this._suggestionContext = null;
    }

    matchesContext(context) {
        const textarea = this.textarea;
        return !!(
            context &&
            !this.disabled &&
            this.isConnected &&
            textarea &&
            this.query === context.query &&
            textarea.value === context.query &&
            textarea.selectionStart === context.caret &&
            textarea.selectionEnd === context.selectionEnd
        );
    }

    /** Reads the text at the caret and shows what fits there, loading an object's fields the first time they are needed. */
    async refreshSuggestions() {
        this.closeSuggestions();
        const version = this._suggestVersion;
        const textarea = this.textarea;
        if (this.disabled || !textarea) {
            this.showResult({ items: [] });
            return;
        }
        const context = readQueryContext(this.query, textarea.selectionStart, textarea.selectionEnd);
        const fieldsOf = (objectName) => this._fieldsByObject.get(String(objectName).toLowerCase());
        const childrenOf = (objectName) => this._childrenByObject.get(String(objectName).toLowerCase());
        let result = suggest(context, fieldsOf, childrenOf);
        while (result.needsObject || result.needsChildren) {
            const objectName = result.needsObject || result.needsChildren;
            const kind = result.needsObject ? 'fields' : 'child relationships';
            this.showResult({ message: `Loading ${kind} for ${objectName}...` }, context);
            try {
                await (result.needsObject
                    ? this.loadDescribe(this._fieldsByObject, objectName, getFieldOptions)
                    : this.loadDescribe(this._childrenByObject, objectName, getChildRelationshipOptions));
            } catch (error) {
                if (version === this._suggestVersion && this.matchesContext(context)) {
                    this.showResult({ message: `Could not load ${kind} for ${objectName}. Choose Retry or press Ctrl+Space.`, retry: true }, context);
                }
                return;
            }
            if (version !== this._suggestVersion || !this.matchesContext(context)) {
                return;
            }
            result = suggest(context, fieldsOf, childrenOf);
        }
        if (result.searchObjects !== undefined) {
            this.showResult({ message: 'Searching objects...' }, context);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            this._objectSearchTimer = setTimeout(() => this.searchObjects(result.searchObjects, context, version), OBJECT_SEARCH_DELAY);
            return;
        }
        this.showResult(result, context);
    }

    async searchObjects(term, context, version) {
        if (version !== this._suggestVersion || !this.matchesContext(context)) {
            return;
        }
        let items = [];
        let message = '';
        let retry = false;
        try {
            const options = (await searchStandardTargetSObjects({ term, operation: QUERY_TOOL_TYPE })) || [];
            items = options.map((option) => ({ value: option.value, label: option.value, detail: (option.label || '').split(' • ')[0], objectOption: true }));
            message = items.length ? (term ? '' : 'Type an object name to narrow the list.') : 'No matching objects you can query.';
        } catch (error) {
            message = 'Could not search objects. Choose Retry or press Ctrl+Space.';
            retry = true;
        }
        if (version === this._suggestVersion && this.matchesContext(context)) {
            this.showResult({ items, message, retry }, context);
        }
    }

    /** Shares pending requests and caches successful responses. A failed request can be retried. */
    async loadDescribe(cache, objectName, load) {
        const key = String(objectName).toLowerCase();
        if (cache.has(key)) {
            return;
        }
        const requestKey = `${cache === this._fieldsByObject ? 'fields' : 'children'}:${key}`;
        if (this._pendingDescribes.has(requestKey)) {
            return this._pendingDescribes.get(requestKey);
        }
        const pending = load({ objectApiName: objectName }).then((options) => {
            cache.set(key, options || []);
        });
        this._pendingDescribes.set(requestKey, pending);
        try {
            await pending;
        } finally {
            this._pendingDescribes.delete(requestKey);
        }
    }

    showResult(result, context) {
        if (context && !this.matchesContext(context)) {
            return;
        }
        const items = result.items || [];
        const onlyTyped = items.length === 1 && context && items[0].value.toLowerCase() === context.term.toLowerCase();
        this.suggestions = onlyTyped ? [] : items;
        this.suggestionMessage = onlyTyped ? '' : result.message || '';
        // A sole match for a typed word is selected. With nothing typed, Enter stays a new line.
        this.activeIndex = this.suggestions.length === 1 && context?.term ? 0 : -1;
        this.canRetry = Boolean(result.retry);
        if (context) {
            this._suggestionContext = context;
            this._replaceFrom = context.replaceFrom;
            this._replaceTo = context.replaceTo;
        }
        if (this.showSuggestions) {
            this.suggestionStyle = this.styleAtCaret(this._replaceFrom);
        }
    }
}
