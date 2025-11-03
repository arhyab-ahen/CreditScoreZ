pragma solidity ^0.8.24;

import { FHE, euint, externalEuint } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CreditScoreZ is ZamaEthereumConfig {
    struct CreditProfile {
        address owner;
        euint encryptedScore;
        uint256 publicData1;
        uint256 publicData2;
        uint256 publicData3;
        bool isVerified;
        uint256 timestamp;
    }

    mapping(address => CreditProfile) private creditProfiles;
    mapping(address => bool) private profileExists;

    event ProfileCreated(address indexed owner, uint256 timestamp);
    event ScoreVerified(address indexed owner, uint256 score);

    constructor() ZamaEthereumConfig() {}

    function createProfile(
        externalEuint encryptedScore,
        bytes calldata inputProof,
        uint256 publicData1,
        uint256 publicData2,
        uint256 publicData3
    ) external {
        require(!profileExists[msg.sender], "Profile already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");

        euint encryptedValue = FHE.fromExternal(encryptedScore, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);

        creditProfiles[msg.sender] = CreditProfile({
            owner: msg.sender,
            encryptedScore: encryptedValue,
            publicData1: publicData1,
            publicData2: publicData2,
            publicData3: publicData3,
            isVerified: false,
            timestamp: block.timestamp
        });
        profileExists[msg.sender] = true;

        emit ProfileCreated(msg.sender, block.timestamp);
    }

    function verifyScore(
        bytes memory abiEncodedClearScore,
        bytes memory decryptionProof
    ) external {
        require(profileExists[msg.sender], "Profile does not exist");
        require(!creditProfiles[msg.sender].isVerified, "Score already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(creditProfiles[msg.sender].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedClearScore, decryptionProof);

        uint256 decodedScore = abi.decode(abiEncodedClearScore, (uint256));
        creditProfiles[msg.sender].isVerified = true;

        emit ScoreVerified(msg.sender, decodedScore);
    }

    function getEncryptedScore(address user) external view returns (euint) {
        require(profileExists[user], "Profile does not exist");
        return creditProfiles[user].encryptedScore;
    }

    function getPublicData(address user) external view returns (
        uint256, 
        uint256, 
        uint256
    ) {
        require(profileExists[user], "Profile does not exist");
        CreditProfile storage profile = creditProfiles[user];
        return (profile.publicData1, profile.publicData2, profile.publicData3);
    }

    function getVerificationStatus(address user) external view returns (bool) {
        require(profileExists[user], "Profile does not exist");
        return creditProfiles[user].isVerified;
    }

    function getProfileTimestamp(address user) external view returns (uint256) {
        require(profileExists[user], "Profile does not exist");
        return creditProfiles[user].timestamp;
    }

    function isProfileCreated(address user) external view returns (bool) {
        return profileExists[user];
    }

    function computeCreditScore(
        address user,
        euint modelParams,
        bytes calldata computationProof
    ) external view returns (euint) {
        require(profileExists[user], "Profile does not exist");
        require(FHE.isInitialized(modelParams), "Invalid model parameters");

        euint[] memory inputs = new euint[](1);
        inputs[0] = creditProfiles[user].encryptedScore;

        return FHE.compute(modelParams, inputs, computationProof);
    }
}


