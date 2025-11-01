import { GroundTruthType } from './typescript-parser';

export interface EvaluationMetrics {
    accuracy: number;
    mrr: number;
    totalPredictions: number;
    correctPredictions: number;
}

export interface DetailedComparison {
    identifier: string;
    groundTruth: GroundTruthType | null;
    predicted: any;
    status: 'correct' | 'incorrect' | 'missing' | 'extra';
    details?: string;
}

export class MetricsCalculator {
    /**
     * Calculate evaluation metrics comparing predictions with ground truth
     * Accuracy is based on the first (most confident) prediction
     * MRR (Mean Reciprocal Rank) is calculated as 1/r where r is the rank of the correct answer
     */
    static calculateMetrics(predicted: any[], groundTruth: GroundTruthType[]): EvaluationMetrics {
        let correctPredictions = 0;
        let totalReciprocalRank = 0;
        let itemsWithMatch = 0;

        // Create maps for easier comparison
        const predictedMap = new Map(predicted.map(p => [p.name, p]));
        const groundTruthMap = new Map(groundTruth.map(gt => [gt.name, gt]));

        // Calculate correct predictions (using first type) and MRR
        for (const [name, pred] of predictedMap) {
            const gt = groundTruthMap.get(name);
            if (gt) {
                // Check if return is an array (new format with 5 predictions)
                if (Array.isArray(pred.types.return)) {
                    // Accuracy: check if first prediction matches
                    const firstPrediction = {
                        ...pred.types,
                        return: pred.types.return[0]
                    };
                    if (this.typesMatch(firstPrediction, gt.types)) {
                        correctPredictions++;
                    }

                    // MRR: find the rank of the correct answer
                    for (let i = 0; i < pred.types.return.length; i++) {
                        const candidatePrediction = {
                            ...pred.types,
                            return: pred.types.return[i]
                        };
                        if (this.typesMatch(candidatePrediction, gt.types)) {
                            totalReciprocalRank += 1 / (i + 1); // rank is 1-indexed
                            itemsWithMatch++;
                            break; // Found the match, stop searching
                        }
                    }
                } else {
                    // Old format with single prediction
                    if (this.typesMatch(pred.types, gt.types)) {
                        correctPredictions++;
                        totalReciprocalRank += 1; // rank 1 for single prediction
                        itemsWithMatch++;
                    }
                }
            }
        }

        const totalPredictions = predicted.length;
        const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
        const mrr = itemsWithMatch > 0 ? totalReciprocalRank / totalPredictions : 0;

        return {
            accuracy,
            mrr,
            totalPredictions,
            correctPredictions
        };
    }

    /**
     * Generate detailed comparison between predictions and ground truth
     */
    static generateDetailedComparison(predicted: any[], groundTruth: GroundTruthType[]): DetailedComparison[] {
        const comparison: DetailedComparison[] = [];
        const predictedMap = new Map(predicted.map(p => [p.name, p]));
        const groundTruthMap = new Map(groundTruth.map(gt => [gt.name, gt]));

        // Check predicted against ground truth
        for (const [name, pred] of predictedMap) {
            const gt = groundTruthMap.get(name);
            if (gt) {
                const isCorrect = this.typesMatch(pred.types, gt.types);
                comparison.push({
                    identifier: name,
                    groundTruth: gt,
                    predicted: pred,
                    status: isCorrect ? 'correct' : 'incorrect',
                    details: isCorrect ? undefined : this.getTypeDifference(pred.types, gt.types)
                });
            } else {
                comparison.push({
                    identifier: name,
                    groundTruth: null,
                    predicted: pred,
                    status: 'extra',
                    details: 'Predicted but not in ground truth'
                });
            }
        }

        // Check ground truth for missing predictions
        for (const [name, gt] of groundTruthMap) {
            if (!predictedMap.has(name)) {
                comparison.push({
                    identifier: name,
                    groundTruth: gt,
                    predicted: null,
                    status: 'missing',
                    details: 'In ground truth but not predicted'
                });
            }
        }

        return comparison.sort((a, b) => a.identifier.localeCompare(b.identifier));
    }

    /**
     * Check if predicted types match ground truth types using TypeScript structural compatibility
     */
    private static typesMatch(predicted: any, groundTruth: any): boolean {
        // Normalize and compare return types using structural compatibility
        if (predicted.return && groundTruth.return) {
            if (!this.isStructurallyCompatible(predicted.return, groundTruth.return)) {
                return false;
            }
        }

        // Check parameters if both have them
        if (predicted.params && groundTruth.params) {
            const predParams = predicted.params;
            const gtParams = groundTruth.params;

            // Check all ground truth parameters are present and structurally compatible
            for (const paramName in gtParams) {
                if (!predParams[paramName]) {
                    return false;
                }

                if (!this.isStructurallyCompatible(predParams[paramName], gtParams[paramName])) {
                    return false;
                }
            }

            // Check no extra parameters in prediction (optional - can be removed if we want to be more lenient)
            for (const paramName in predParams) {
                if (!gtParams[paramName]) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check if predicted type is structurally compatible with ground truth type
     * According to TypeScript's structural typing rules
     */
    private static isStructurallyCompatible(predictedType: string, groundTruthType: string): boolean {
        const normalizedPredicted = this.normalizeType(predictedType);
        const normalizedGroundTruth = this.normalizeType(groundTruthType);

        // If they're exactly the same, they're compatible
        if (normalizedPredicted === normalizedGroundTruth) {
            return true;
        }

        // Handle object type compatibility
        if (this.isObjectType(normalizedPredicted) && this.isObjectType(normalizedGroundTruth)) {
            return this.areObjectTypesCompatible(normalizedPredicted, normalizedGroundTruth);
        }

        // Handle union types (basic support)
        if (this.isUnionType(normalizedGroundTruth)) {
            const unionTypes = this.parseUnionType(normalizedGroundTruth);
            return unionTypes.some(unionType => this.isStructurallyCompatible(predictedType, unionType));
        }

        // Handle array types
        if (this.isArrayType(normalizedPredicted) && this.isArrayType(normalizedGroundTruth)) {
            const predElementType = this.extractArrayElementType(normalizedPredicted);
            const gtElementType = this.extractArrayElementType(normalizedGroundTruth);
            return this.isStructurallyCompatible(predElementType, gtElementType);
        }

        // Handle basic type compatibility
        return this.areBasicTypesCompatible(normalizedPredicted, normalizedGroundTruth);
    }

    /**
     * Check if two object types are structurally compatible
     */
    private static areObjectTypesCompatible(predictedType: string, groundTruthType: string): boolean {
        const predProps = this.parseObjectType(predictedType);
        const gtProps = this.parseObjectType(groundTruthType);

        // For structural compatibility, the predicted type must have all required properties
        // of the ground truth type with compatible types
        for (const [propName, gtPropInfo] of gtProps) {
            const predPropInfo = predProps.get(propName);

            // If property is required in ground truth but missing in predicted, incompatible
            if (!gtPropInfo.optional && !predPropInfo) {
                return false;
            }

            // If property exists in both, check type compatibility
            if (predPropInfo && !this.isStructurallyCompatible(predPropInfo.type, gtPropInfo.type)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Parse object type string into a map of property names to type info
     */
    private static parseObjectType(objectType: string): Map<string, { type: string, optional: boolean }> {
        const props = new Map<string, { type: string, optional: boolean }>();

        // Remove braces and split by commas
        const content = objectType.slice(1, -1); // Remove { and }
        if (!content.trim()) return props;

        const properties = content.split(',');

        for (const prop of properties) {
            const trimmed = prop.trim();
            if (!trimmed) continue;

            const colonIndex = trimmed.indexOf(':');
            if (colonIndex === -1) continue;

            const nameWithOptional = trimmed.substring(0, colonIndex).trim();
            const type = trimmed.substring(colonIndex + 1).trim();

            const optional = nameWithOptional.endsWith('?');
            const name = optional ? nameWithOptional.slice(0, -1) : nameWithOptional;

            props.set(name, { type, optional });
        }

        return props;
    }

    /**
     * Check if a type string represents an object type
     */
    private static isObjectType(type: string): boolean {
        return type.startsWith('{') && type.endsWith('}');
    }

    /**
     * Check if a type string represents a union type
     */
    private static isUnionType(type: string): boolean {
        return type.includes('|');
    }

    /**
     * Parse union type into individual types
     */
    private static parseUnionType(type: string): string[] {
        return type.split('|').map(t => t.trim());
    }

    /**
     * Check if a type string represents an array type
     */
    private static isArrayType(type: string): boolean {
        return type.endsWith('array') || type.endsWith('[]');
    }

    /**
     * Extract element type from array type
     */
    private static extractArrayElementType(arrayType: string): string {
        if (arrayType.endsWith('array')) {
            return arrayType.slice(0, -5); // Remove 'array'
        }
        if (arrayType.endsWith('[]')) {
            return arrayType.slice(0, -2); // Remove '[]'
        }
        return 'unknown';
    }

    /**
     * Check basic type compatibility (number, string, boolean, etc.)
     */
    private static areBasicTypesCompatible(predicted: string, groundTruth: string): boolean {
        // 'any' is compatible with everything
        if (predicted === 'any' || groundTruth === 'any') {
            return true;
        }

        // 'unknown' in predicted is compatible with specific types in ground truth
        if (predicted === 'unknown') {
            return true;
        }

        // Exact match
        return predicted === groundTruth;
    }

    /**
     * Normalize type strings for comparison
     */
    private static normalizeType(type: string): string {
        return type.toLowerCase()
            .replace(/\s/g, '')
            .replace(/\[\]/g, 'array')
            .replace(/array<([^>]+)>/g, '$1array')
            .replace(/\{\}/g, 'object')
            .replace(/promise<([^>]+)>/g, 'promise')
            // Normalize object type separators: both ',' and ';' should be treated the same
            .replace(/[;,]/g, ',')
            // Sort object properties for consistent comparison
            .replace(/\{([^}]+)\}/g, (match, content) => {
                const properties = content.split(',')
                    .map((prop: string) => prop.trim())
                    .filter((prop: string) => prop.length > 0)
                    .sort();
                return `{${properties.join(',')}}`;
            });
    }

    /**
     * Get detailed description of type differences
     */
    private static getTypeDifference(predicted: any, groundTruth: any): string {
        const differences: string[] = [];

        if (predicted.return && groundTruth.return) {
            if (!this.isStructurallyCompatible(predicted.return, groundTruth.return)) {
                differences.push(`Return type: predicted '${predicted.return}' is not compatible with '${groundTruth.return}'`);
            }
        }

        if (predicted.params && groundTruth.params) {
            for (const paramName in groundTruth.params) {
                if (!predicted.params[paramName]) {
                    differences.push(`Missing parameter: ${paramName}`);
                } else {
                    if (!this.isStructurallyCompatible(predicted.params[paramName], groundTruth.params[paramName])) {
                        differences.push(`Parameter ${paramName}: predicted '${predicted.params[paramName]}' is not compatible with '${groundTruth.params[paramName]}'`);
                    }
                }
            }
        }

        return differences.join('; ');
    }
}