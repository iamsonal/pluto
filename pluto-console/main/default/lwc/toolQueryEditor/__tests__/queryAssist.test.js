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

import { bindNameFor, rankSuggestions, readQueryContext, suggest } from '../queryAssist';

const FIELDS = {
    case: [
        { value: 'Id', label: 'Case ID', dataType: 'ID' },
        {
            value: 'Status',
            label: 'Status',
            dataType: 'PICKLIST',
            isPicklist: true,
            picklistValues: [
                { value: 'New', label: 'New' },
                { value: 'Closed', label: 'Closed' }
            ]
        },
        { value: 'AccountId', label: 'Account ID', dataType: 'REFERENCE', referenceTo: 'Account', relationshipName: 'Account' },
        { value: 'WhatId__c', label: 'Related', dataType: 'REFERENCE', referenceTo: 'Account' },
        { value: 'IsEscalated', label: 'Escalated', dataType: 'BOOLEAN' },
        { value: 'ClosedDate', label: 'Closed Date', dataType: 'DATETIME' },
        { value: 'Subject', label: 'Subject', dataType: 'STRING', filterable: true, sortable: true },
        { value: 'Description', label: 'Description', dataType: 'TEXTAREA', filterable: false, sortable: false },
        { value: 'Tags__c', label: 'Tags', dataType: 'MULTIPICKLIST', filterable: true, sortable: false }
    ],
    account: [
        { value: 'Name', label: 'Account Name', dataType: 'STRING' },
        { value: 'OwnerId', label: 'Owner ID', dataType: 'REFERENCE', referenceTo: 'User', relationshipName: 'Owner', pointsToUser: true }
    ],
    user: [{ value: 'Email', label: 'Email', dataType: 'EMAIL' }]
};
FIELDS.contact = [
    { value: 'LastName', label: 'Last Name', dataType: 'STRING' },
    { value: 'Email', label: 'Email', dataType: 'EMAIL' }
];
const CHILDREN = {
    account: [
        { value: 'Contacts', label: 'Contact' },
        { value: 'Cases', label: 'Case' }
    ],
    contact: [{ value: 'Cases', label: 'Case' }],
    case: []
};
const fieldsOf = (name) => FIELDS[String(name).toLowerCase()] || [];
const childrenOf = (name) => CHILDREN[String(name).toLowerCase()] || [];

function at(query) {
    const caret = query.indexOf('|');
    return suggest(readQueryContext(query.replace('|', ''), caret < 0 ? undefined : caret), fieldsOf, childrenOf);
}

function labels(result) {
    return result.items.map((item) => item.label);
}

describe('queryAssist', () => {
    it('starts with SELECT and offers the fields of the FROM object, even before FROM is typed', () => {
        expect(labels(at('SEL'))).toEqual(['SELECT']);
        expect(labels(at('SELECT Sta| FROM Case LIMIT 5'))).toEqual(['Status']);
        expect(labels(at('SELECT Id, | FROM Case'))).toContain('Account.');
        expect(labels(at('SELECT Id |FROM Case'))).toEqual(['FROM']);
    });

    it('offers the starter only for a new outer query', () => {
        expect(at('').items[0]).toMatchObject({ label: 'SELECT', insertValue: 'SELECT Id FROM ' });
        expect(at('SEL').items[0].insertValue).toBe('SELECT Id FROM ');
        expect(at('SEL| FROM Case').items[0].insertValue).toBeUndefined();
    });

    it('lists objects after FROM and searches after two letters are typed', () => {
        expect(at('SELECT Id FROM ')).toEqual({ searchObjects: '', items: [] });
        expect(at('SELECT Id FROM C')).toEqual({ items: [] });
        expect(at('SELECT Id FROM Ca')).toEqual({ searchObjects: 'Ca', items: [] });
        expect(labels(at('SELECT Id FROM Case '))).toEqual(['WHERE', 'ORDER BY', 'LIMIT']);
    });

    it('follows parent paths only through one-object lookups, loading each object when first needed', () => {
        expect(labels(at('SELECT Account.Owner.E| FROM Case'))).toEqual(['Email']);
        expect(labels(at('SELECT WhatId__r.| FROM Case'))).toEqual([]);
        expect(suggest(readQueryContext('SELECT Account.N FROM Case', 16), (name) => (name === 'Case' ? FIELDS.case : undefined))).toEqual({
            needsObject: 'Account',
            items: []
        });
    });

    it('offers a parameter named after the field, :anchorId for lookups, and fixed values', () => {
        expect(labels(at('SELECT Id FROM Case WHERE AccountId = '))).toEqual([':anchorId', ':accountId', 'NULL']);
        expect(labels(at('SELECT Id FROM Account WHERE OwnerId = '))).toEqual([':anchorId', ':initiatingUserId', ':principalUserId', ':ownerId', 'NULL']);
        expect(labels(at('SELECT Id FROM Case WHERE Status IN '))).toEqual([':statuses']);
        expect(labels(at('SELECT Id FROM Case WHERE Status = '))).toEqual([':status', "'New'", "'Closed'", 'NULL']);
        expect(labels(at("SELECT Id FROM Case WHERE Status = 'Ne"))).toEqual(['New']);
        expect(labels(at("SELECT Id FROM Case WHERE Status IN ('New', "))).toEqual(["'New'", "'Closed'"]);
        expect(labels(at('SELECT Id FROM Case WHERE IsEscalated = '))).toEqual([':isEscalated', 'TRUE', 'FALSE', 'NULL']);
        expect(labels(at('SELECT Id FROM Case WHERE ClosedDate > LAST'))).toEqual(['LAST_N_DAYS:30', 'LAST_MONTH']);
        expect(labels(at('SELECT Id FROM Case WHERE Account.Name = :'))).toEqual([':accountName']);
    });

    it('reads a child subquery through its relationship: child relationships after FROM, then the child object fields', () => {
        expect(labels(at('SELECT Id, (SELECT Id FROM Con|) FROM Account WHERE AccountNumber = :accountNumber'))).toEqual(['Contacts']);
        expect(labels(at('SELECT Id, (SELECT Id FROM |) FROM Account'))).toEqual(['Cases', 'Contacts']);
        expect(labels(at('SELECT Id, (SELECT Id, Last| FROM Contacts) FROM Account WHERE AccountNumber = :accountNumber'))).toEqual(['LastName']);
        expect(labels(at('SELECT Id, (SELECT Id FROM Contacts WHERE LastName = |) FROM Account'))).toEqual([':lastName', 'NULL']);
        expect(labels(at('SELECT Id, (SELECT Id, (SELECT | FROM Cases) FROM Contacts) FROM Account'))).toContain('Status');
        expect(labels(at('SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE Na|'))).toEqual(['Name']);
        expect(at('SELECT Id, (SELECT | FROM Nope) FROM Account').message).toBe('Nope is not a child relationship Pluto can find, or you cannot read it.');
    });

    describe('subqueries being written', () => {
        it('reads a subquery added to an existing query before its ) is typed', () => {
            expect(labels(at('SELECT Name, (SELECT Id FROM | FROM Account'))).toEqual(['Cases', 'Contacts']);
            expect(labels(at('SELECT Name, (SELECT La| FROM Contacts FROM Account'))).toEqual(['LastName']);
            expect(at('SELECT Name, (SELECT La| FROM Account').message).toBe('Write FROM and a child relationship, such as Contacts, to see its fields.');
            expect(labels(at('SELECT Name, (SELECT Id FROM Contacts WHERE | FROM Account'))).toEqual(['Email', 'LastName']);
            expect(labels(at('SELECT Name, (SELECT Id FROM Contacts FROM Account WHERE Na|'))).toEqual(['Name']);
        });

        it('offers FROM after a closed child subquery', () => {
            expect(labels(at('SELECT Name, (SELECT Id FROM Contacts) |'))).toEqual(['FROM']);
            expect(labels(at('SELECT Name, (SELECT Id FROM Contacts) F|'))).toEqual(['FROM']);
            expect(labels(at('SELECT toLabel(Status) |'))).toEqual(['FROM']);
        });

        it('offers SELECT right after ( in the SELECT list, and after IN ( for an Id or lookup field', () => {
            expect(labels(at('SELECT Name, (|'))).toEqual(['SELECT']);
            expect(labels(at('SELECT Name, (S| FROM Account'))).toEqual(['SELECT']);
            expect(labels(at('SELECT toLabel(|'))).toEqual([]);
            expect(labels(at('SELECT Id FROM Case WHERE AccountId IN (|'))).toEqual(['SELECT']);
            expect(labels(at('SELECT Id FROM Case WHERE AccountId NOT IN (|'))).toEqual(['SELECT']);
            expect(labels(at('SELECT Id FROM Case WHERE Status IN (|'))).toEqual(["'New'", "'Closed'"]);
            expect(labels(at("SELECT Id FROM Case WHERE AccountId IN ('001000000000001', |"))).toEqual([]);
        });

        it('gives a child LIMIT its own input, named after the relationship', () => {
            expect(labels(at('SELECT Name, (SELECT LastName FROM Contacts LIMIT |) FROM Account'))).toEqual([':maxContacts']);
            expect(labels(at('SELECT Name, (SELECT LastName FROM Contacts) FROM Account LIMIT |'))).toEqual([':maxRecords']);
        });

        it('does not offer OFFSET inside a child subquery', () => {
            expect(labels(at('SELECT Name, (SELECT LastName FROM Contacts LIMIT 5 |) FROM Account'))).toEqual([]);
            expect(labels(at('SELECT Name, (SELECT LastName FROM Contacts) FROM Account LIMIT 5 |'))).toEqual(['OFFSET']);
        });

        it('asks for the main FROM first when a child subquery has no object to read from', () => {
            expect(at('SELECT Name, (SELECT Id FROM |').message).toBe(
                'Write FROM and an object for the main query first. Its child relationships fill this subquery.'
            );
            expect(at('SELECT Name, |').message).toBe('Write FROM and an object to see its fields.');
        });

        it('offers only Id and lookup fields in the SELECT of a WHERE subquery', () => {
            expect(labels(at('SELECT Id FROM Account WHERE Id IN (SELECT | FROM Case)'))).toEqual(['AccountId', 'Id', 'WhatId__c']);
            expect(labels(at('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Case WHERE |)'))).toContain('Status');
        });
    });

    it('offers parameters inside a filter subquery, typed from its own object', () => {
        expect(labels(at('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Case WHERE Status = '))).toEqual([':status', "'New'", "'Closed'", 'NULL']);
        expect(labels(at('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Case) '))).toEqual(['AND', 'OR', 'ORDER BY', 'LIMIT']);
    });

    it('offers what comes next after a condition, in ORDER BY, and at LIMIT', () => {
        expect(labels(at('SELECT Id FROM Case WHERE Status = :status '))).toEqual(['AND', 'OR', 'ORDER BY', 'LIMIT']);
        expect(labels(at('SELECT Id FROM Case WHERE Status '))).toContain('NOT IN');
        expect(labels(at('SELECT Id FROM Case ORDER BY ClosedDate '))).toEqual(['ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'LIMIT']);
        expect(labels(at('SELECT Id FROM Case LIMIT '))).toEqual([':maxRecords']);
        expect(labels(at('SELECT Id FROM Case LIMIT :m'))).toEqual([':maxRecords']);
        expect(labels(at('SELECT Id FROM Case LIMIT 10 '))).toEqual(['OFFSET']);
        expect(labels(at('SELECT Id FROM Case LIMIT 10 OFFSET '))).toEqual([':skipRecords']);
    });

    it('names an object it cannot find or the user cannot read', () => {
        expect(at('SELECT | FROM Acount').message).toBe('Pluto cannot find the object Acount, or you cannot read it.');
        expect(at('SELECT | ').message).toBe('Write FROM and an object to see its fields.');
    });

    it('ignores quoted text that looks like a clause', () => {
        expect(labels(at("SELECT Id FROM Case WHERE Subject = 'FROM Account WHERE' "))).toEqual(['AND', 'OR', 'ORDER BY', 'LIMIT']);
    });

    it('names parameters in camel case and plural for lists', () => {
        expect(bindNameFor('Region__c', false)).toBe('region');
        expect(bindNameFor('Account.Billing_City__c', false)).toBe('accountBillingCity');
        expect(bindNameFor('Status', true)).toBe('statuses');
        expect(bindNameFor('Priority', true)).toBe('priorities');
        expect(bindNameFor('AccountId', true)).toBe('accountIds');
    });

    it('ranks exact, then prefix, then anywhere matches', () => {
        const items = ['MyStatus', 'Status__c', 'Status'].map((label) => ({ label, value: label }));
        expect(rankSuggestions(items, 'status').map((item) => item.label)).toEqual(['Status', 'Status__c', 'MyStatus']);
    });

    it('replaces the remainder of a field or bind token, without consuming its punctuation', () => {
        for (const query of ['SELECT Stat|us, Id FROM Case', 'SELECT Id FROM Case WHERE Status = :sta|tus)']) {
            const caret = query.indexOf('|');
            const text = query.replace('|', '');
            const context = readQueryContext(text, caret);
            expect(text.slice(context.replaceFrom, context.replaceTo)).toBe(query.includes(':sta') ? ':status' : 'Status');
            expect(text[context.replaceTo]).toBe(query.includes(':sta') ? ')' : ',');
        }
    });

    it('consumes an existing closing quote and escapes a suggested picklist value', () => {
        const query = "SELECT Id FROM Case WHERE Status = 'Ne|w' AND Id = :id";
        const caret = query.indexOf('|');
        const text = query.replace('|', '');
        const context = readQueryContext(text, caret);
        const result = suggest(context, fieldsOf);
        expect(text.slice(context.replaceFrom, context.replaceTo)).toBe("New'");
        expect(text.slice(0, context.replaceFrom) + result.items[0].value + text.slice(context.replaceTo)).toBe(text);
        const escaped = suggest(readQueryContext("SELECT Id FROM Case WHERE Status = 'O"), () => [
            { value: 'Status', isPicklist: true, picklistValues: [{ value: "O'Brien\\New", label: 'Escaped value' }] }
        ]);
        expect(escaped.items[0].value).toBe("O\\'Brien\\\\New'");
        const typed = "SELECT Id FROM Case WHERE Status = 'O\\'B";
        const afterEscape = readQueryContext(typed);
        const choices = suggest(afterEscape, () => [{ value: 'Status', isPicklist: true, picklistValues: [{ value: "O'Brien", label: "O'Brien" }] }]);
        expect(choices.items[0].value).toBe("O\\'Brien'");
        expect(typed.slice(0, afterEscape.replaceFrom)).toBe("SELECT Id FROM Case WHERE Status = '");
    });

    it('includes a selected token in the replacement range', () => {
        const query = 'SELECT Subject FROM Case';
        const start = query.indexOf('Subject');
        const context = readQueryContext(query, start, start + 'Subject'.length);
        expect(query.slice(context.replaceFrom, context.replaceTo)).toBe('Subject');
    });

    it('replaces symbol operators around the caret and filters by the typed prefix', () => {
        for (const marked of ['SELECT Id FROM Case WHERE Status !|', 'SELECT Id FROM Case WHERE Status !|=']) {
            const caret = marked.indexOf('|');
            const query = marked.replace('|', '');
            const context = readQueryContext(query, caret);
            const result = suggest(context, fieldsOf);
            expect(result.items.map((item) => item.value)).toEqual(['!=']);
            expect(query.slice(0, context.replaceFrom) + result.items[0].value + query.slice(context.replaceTo)).toBe('SELECT Id FROM Case WHERE Status !=');
        }
        expect(labels(at('SELECT Id FROM Case WHERE ClosedDate <'))).toEqual(['<', '<=']);
    });

    it('offers operators for the field type, including related fields', () => {
        expect(labels(at('SELECT Id FROM Case WHERE IsEscalated '))).toEqual(['=', '!=']);
        expect(labels(at('SELECT Id FROM Case WHERE Status '))).toEqual(['=', '!=', 'IN', 'NOT IN']);
        expect(labels(at('SELECT Id FROM Case WHERE ClosedDate '))).not.toContain('LIKE');
        expect(labels(at('SELECT Id FROM Case WHERE Subject '))).toContain('LIKE');
        expect(labels(at('SELECT Id FROM Case WHERE Account.Name '))).toContain('LIKE');
        expect(labels(at('SELECT Id FROM Case WHERE Tags__c '))).toEqual(['=', '!=', 'INCLUDES', 'EXCLUDES']);
        expect(labels(at('SELECT Id FROM Case WHERE Description '))).toEqual([]);
    });

    it('keeps readable fields in SELECT but filters WHERE and ORDER BY by their capabilities', () => {
        expect(labels(at('SELECT Desc| FROM Case'))).toContain('Description');
        expect(labels(at('SELECT Id FROM Case WHERE Desc'))).not.toContain('Description');
        expect(labels(at('SELECT Id FROM Case ORDER BY Desc'))).not.toContain('Description');
        expect(labels(at('SELECT Id FROM Case WHERE Tags'))).toContain('Tags__c');
        expect(labels(at('SELECT Id FROM Case ORDER BY Tags'))).not.toContain('Tags__c');
        expect(labels(at('SELECT Id FROM Case ORDER BY Sub'))).toContain('Subject');
    });
});
