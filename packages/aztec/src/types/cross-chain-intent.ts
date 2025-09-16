import { Fr } from '@aztec/aztec.js';

export interface CrossChainIntent {
    targetChain: number;
    targetAddress: string;
    messageHash: Fr;
}

export class IntentBuilder {
    static createSimpleIntent(
        targetChain: number,
        targetAddress: string,
        data: string
    ): CrossChainIntent {
        // Convert string to hex then to Fr
        const hexData = '0x' + Buffer.from(data).toString('hex');
        const messageHash = Fr.fromString(hexData);
        
        return {
            targetChain,
            targetAddress,
            messageHash,
        };
    }
}