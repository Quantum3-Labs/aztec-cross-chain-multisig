import 'dotenv/config';
import { Fr, AccountManager } from '@aztec/aztec.js';
import { MyCustomAccountContract } from './MyCustomAccount.js';
import { setupPXE } from '../utils/setup_pxe.js';

const SALT = Fr.fromString(process.env.SALT!);

export async function getCustomWallet() {
    const pxe = await setupPXE();
    const encryptionSecretKey = Fr.random();
    const accountContract = new MyCustomAccountContract();
    
    const account = await AccountManager.create(
        pxe, 
        encryptionSecretKey, 
        accountContract,
        SALT
    );
    
    // Register account if needed
    if (!(await account.isDeployable())) {
        await account.register();
        console.log('Account registered');
    }
    
    const wallet = await account.getWallet();
    return { wallet, pxe, account };
}