import { GroundTruthType } from './typescript-parser';

export interface EvaluationMetrics {
    precision: number;
    recall: number;
    f1Score: number;
    accuracy: number;
    totalPredictions: number;
    correctPredictions: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
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
     */
    static calculateMetrics(predicted: any[], groundTruth: GroundTruthType[]): EvaluationMetrics {
        let truePositives = 0;
        let falsePositives = 0;
        let falseNegatives = 0;
        let correctPredictions = 0;

        // Create maps for easier comparison
        const predictedMap = new Map(predicted.map(p => [p.name, p]));
        const groundTruthMap = new Map(groundTruth.map(gt => [gt.name, gt]));

        // Calculate true positives and false positives
        for (const [name, pred] of predictedMap) {
            const gt = groundTruthMap.get(name);
            if (gt) {
                if (this.typesMatch(pred.types, gt.types)) {
                    truePositives++;
                    correctPredictions++;
                } else {
                    falsePositives++;
                }
            } else {
                falsePositives++;
            }
        }

        // Calculate false negatives
        for (const [name] of groundTruthMap) {
            if (!predictedMap.has(name)) {
                falseNegatives++;
            }
        }

        const totalPredictions = predicted.length;
        const precision = truePositives / (truePositives + falsePositives) || 0;
        const recall = truePositives / (truePositives + falseNegatives) || 0;
        const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
        const accuracy = correctPredictions / totalPredictions || 0;

        return {
            precision,
            recall,
            f1Score,
            accuracy,
            totalPredictions,
            correctPredictions,
            truePositives,
            falsePositives,
            falseNegatives
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
     * Check if predicted types match ground truth types
     */
    private static typesMatch(predicted: any, groundTruth: any): boolean {
        // Normalize and compare return types
        if (predicted.return && groundTruth.return) {
            const normalizedPredicted = this.normalizeType(predicted.return);
            const normalizedGroundTruth = this.normalizeType(groundTruth.return);

            if (normalizedPredicted !== normalizedGroundTruth) {
                return false;
            }
        }

        // Check parameters if both have them
        if (predicted.params && groundTruth.params) {
            const predParams = predicted.params;
            const gtParams = groundTruth.params;

            // Check all ground truth parameters are present and match
            for (const paramName in gtParams) {
                if (!predParams[paramName]) {
                    return false;
                }

                const normalizedPredParam = this.normalizeType(predParams[paramName]);
                const normalizedGtParam = this.normalizeType(gtParams[paramName]);

                if (normalizedPredParam !== normalizedGtParam) {
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
            const predReturn = this.normalizeType(predicted.return);
            const gtReturn = this.normalizeType(groundTruth.return);
            if (predReturn !== gtReturn) {
                differences.push(`Return type: predicted '${predicted.return}' vs actual '${groundTruth.return}'`);
            }
        }

        if (predicted.params && groundTruth.params) {
            for (const paramName in groundTruth.params) {
                if (!predicted.params[paramName]) {
                    differences.push(`Missing parameter: ${paramName}`);
                } else {
                    const predParam = this.normalizeType(predicted.params[paramName]);
                    const gtParam = this.normalizeType(groundTruth.params[paramName]);
                    if (predParam !== gtParam) {
                        differences.push(`Parameter ${paramName}: predicted '${predicted.params[paramName]}' vs actual '${groundTruth.params[paramName]}'`);
                    }
                }
            }
        }

        return differences.join('; ');
    }
}