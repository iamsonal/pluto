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

/**
 * Transaction-cached access to each field's Data Sensitivity Level. A field is
 * sensitive at any level except Public and Internal, so a level an admin adds
 * is protected too. Compliance Categorization records which rules apply, not
 * how sensitive a value is, so it is not read. This module caches metadata
 * only; it never retains record values.
 */
public inherited sharing class SchemaFieldClassificationService {
    private static final Set<String> OPEN_LEVELS = new Set<String>{ 'public', 'internal' };
    private static Map<String, Set<String>> sensitiveFieldsByObject = new Map<String, Set<String>>();
    @TestVisible
    private static Map<String, Set<String>> sensitiveFieldOverrides = new Map<String, Set<String>>();

    public static Boolean isSensitive(String objectApiName, String fieldApiName) {
        if (String.isBlank(objectApiName) || String.isBlank(fieldApiName)) {
            return false;
        }
        String objectKey = objectApiName.trim().toLowerCase();
        if (sensitiveFieldOverrides.containsKey(objectKey)) {
            return sensitiveFieldOverrides.get(objectKey).contains(fieldApiName.trim().toLowerCase());
        }
        load(objectApiName.trim(), objectKey);
        return sensitiveFieldsByObject.get(objectKey).contains(fieldApiName.trim().toLowerCase());
    }

    private static void load(String objectApiName, String objectKey) {
        if (sensitiveFieldsByObject.containsKey(objectKey)) {
            return;
        }
        Set<String> sensitiveFields = new Set<String>();
        // Classification is setup metadata, not record data. Masking must not depend on what the
        // run's user may see in Setup. In user mode this query can fail with an uncatchable
        // internal error for a minimum-access user when fields on the object are classified.
        for (
            SObject fieldMetadata : Database.query(
                'SELECT QualifiedApiName, SecurityClassification FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = :objectApiName',
                AccessLevel.SYSTEM_MODE
            )
        ) {
            if (isSensitiveLevel(stringValue(fieldMetadata.get('SecurityClassification')))) {
                sensitiveFields.add(normalize(stringValue(fieldMetadata.get('QualifiedApiName'))));
            }
        }
        sensitiveFieldsByObject.put(objectKey, sensitiveFields);
    }

    @TestVisible
    private static Boolean isSensitiveLevel(String level) {
        String normalized = normalize(level);
        return normalized != '' && !OPEN_LEVELS.contains(normalized);
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String normalize(String value) {
        return String.isBlank(value) ? '' : value.trim().toLowerCase();
    }

    @TestVisible
    private static void clearCache() {
        sensitiveFieldsByObject.clear();
        sensitiveFieldOverrides.clear();
    }
}
