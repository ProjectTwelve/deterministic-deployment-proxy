import { config } from "dotenv";
import { providers, Wallet } from "ethers";
import {
	keccak256,
	parseEther,
	parseUnits,
	recoverAddress,
	serializeTransaction,
	UnsignedTransaction,
} from "ethers/lib/utils";

import { promises as filesystem } from "fs";
import * as path from "path";
import { CompilerOutput, CompilerInput, compileStandardWrapper } from "solc";

config();

async function compileContracts(): Promise<CompilerOutput> {
	const solidityFilePath = path.join(
		__dirname,
		"..",
		"source",
		"deterministic-deployment-proxy.yul"
	);
	const soliditySourceCode = await filesystem.readFile(
		solidityFilePath,
		"utf8"
	);
	const compilerInput: CompilerInput = {
		language: "Yul",
		settings: {
			optimizer: {
				enabled: true,
				details: {
					yul: true,
				},
			},
			outputSelection: {
				"*": {
					"*": ["abi", "evm.bytecode.object", "evm.gasEstimates"],
				},
			},
		},
		sources: {
			"deterministic-deployment-proxy.yul": {
				content: soliditySourceCode,
			},
		},
	};
	const compilerInputJson = JSON.stringify(compilerInput);
	const compilerOutputJson = compileStandardWrapper(compilerInputJson);
	const compilerOutput = JSON.parse(compilerOutputJson) as CompilerOutput;
	const errors = compilerOutput.errors;
	if (errors) {
		let concatenatedErrors = "";

		for (let error of errors) {
			if (/Yul is still experimental/.test(error.message)) continue;
			concatenatedErrors += error.formattedMessage + "\n";
		}

		if (concatenatedErrors.length > 0) {
			throw new Error(
				"The following errors/warnings were returned by solc:\n\n" +
					concatenatedErrors
			);
		}
	}

	return compilerOutput;
}
export function arrayFromHexString(value: string): Uint8Array {
	const normalized = value.length % 2 ? `0${value}` : value;
	const bytes = [];
	for (let i = 0; i < normalized.length; i += 2) {
		bytes.push(Number.parseInt(`${normalized[i]}${normalized[i + 1]}`, 16));
	}
	return new Uint8Array(bytes);
}

const key = process.env.privateKey!;

async function main() {
	const RPC_URL = "https://testnet.p12.games";
	const provider = new providers.JsonRpcProvider(RPC_URL);
	const wallet = new Wallet(key, provider);

	const chainId = (await provider.getNetwork()).chainId;

	const compilerOutput = await compileContracts();
	const contract =
		compilerOutput.contracts["deterministic-deployment-proxy.yul"]["Proxy"];

	const deploymentBytecode = contract.evm.bytecode.object;

	const nonce: number = 0;
	const gasLimit = 100000;
	// const to = ethers.constants.AddressZero;
	const value = 0;
	const data = "0x" + deploymentBytecode;
	const v = 27;
	const r =
		"0x2222222222222222222222222222222222222222222222222222222222222222";
	const s =
		"0x2222222222222222222222222222222222222222222222222222222222222222";

	const unsignedTransaction: UnsignedTransaction = {
		// to: to,
		value: value,
		nonce: nonce,
		gasLimit: gasLimit,
		data: data,
		chainId: chainId,
		gasPrice: parseUnits("10", "gwei"),
	};

	const hash = keccak256(serializeTransaction(unsignedTransaction));

	const signer = recoverAddress(hash, { r, s, v });

	// sending gas to the deployer
	await wallet.sendTransaction({
		from: wallet.address,
		to: signer,
		value: parseEther("0.05"),
	});

	// deploy proxy contract
	await provider.sendTransaction(
		serializeTransaction(unsignedTransaction, { r: r, s: s, v: v })
	);
}

if (require.main === module) {
	main().catch((e) => {
		console.error("Error", e);
		process.exit(1);
	});
}
