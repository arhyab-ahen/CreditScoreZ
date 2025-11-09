import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface CreditScoreData {
  id: number;
  name: string;
  score: string;
  activity: string;
  valuation: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface CreditAnalysis {
  riskLevel: number;
  lendingCapacity: number;
  repaymentProbability: number;
  growthPotential: number;
  stabilityScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState<CreditScoreData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingScore, setCreatingScore] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newScoreData, setNewScoreData] = useState({ name: "", score: "", activity: "" });
  const [selectedScore, setSelectedScore] = useState<CreditScoreData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ score: number | null; activity: number | null }>({ score: null, activity: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<any[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const scoresList: CreditScoreData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          scoresList.push({
            id: parseInt(businessId.replace('score-', '')) || Date.now(),
            name: businessData.name,
            score: businessId,
            activity: businessId,
            valuation: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setScores(scoresList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createScore = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingScore(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating credit score with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newScoreData.score) || 0;
      const businessId = `score-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newScoreData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newScoreData.activity) || 0,
        0,
        "Encrypted Credit Score"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: "create",
        timestamp: Date.now(),
        name: newScoreData.name,
        score: scoreValue
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Credit score created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewScoreData({ name: "", score: "", activity: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingScore(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, {
        type: "decrypt",
        timestamp: Date.now(),
        score: Number(clearValue)
      }]);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const analyzeCredit = (score: CreditScoreData, decryptedScore: number | null, decryptedActivity: number | null): CreditAnalysis => {
    const creditScore = score.isVerified ? (score.decryptedValue || 0) : (decryptedScore || score.publicValue1 || 5);
    const activity = score.publicValue1 || 5;
    
    const baseRisk = Math.max(5, Math.min(95, 100 - creditScore));
    const riskLevel = Math.round(baseRisk + (100 - activity * 10));
    
    const lendingCapacity = Math.min(1000000, Math.round(creditScore * 1000));
    const repaymentProbability = Math.min(99, Math.round(creditScore * 0.8 + activity * 2));
    const growthPotential = Math.min(95, Math.round((creditScore * 0.6 + activity * 0.4) * 0.8));
    const stabilityScore = Math.round(creditScore * 0.7 + activity * 3);

    return {
      riskLevel,
      lendingCapacity,
      repaymentProbability,
      growthPotential,
      stabilityScore
    };
  };

  const renderDashboard = () => {
    const totalScores = scores.length;
    const verifiedScores = scores.filter(s => s.isVerified).length;
    const avgScore = scores.length > 0 
      ? scores.reduce((sum, s) => sum + (s.decryptedValue || s.publicValue1), 0) / scores.length 
      : 0;
    
    const highScores = scores.filter(s => 
      (s.decryptedValue || s.publicValue1) >= 700
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel">
          <h3>Total Credit Profiles</h3>
          <div className="stat-value">{totalScores}</div>
          <div className="stat-trend">+{highScores} excellent</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>FHE Verified</h3>
          <div className="stat-value">{verifiedScores}/{totalScores}</div>
          <div className="stat-trend">On-chain Secured</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Average Score</h3>
          <div className="stat-value">{avgScore.toFixed(0)}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (score: CreditScoreData, decryptedScore: number | null, decryptedActivity: number | null) => {
    const analysis = analyzeCredit(score, decryptedScore, decryptedActivity);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.riskLevel}%` }}
            >
              <span className="bar-value">{analysis.riskLevel}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Lending Capacity</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.lendingCapacity/10000)}%` }}
            >
              <span className="bar-value">${analysis.lendingCapacity.toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Repayment Probability</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.repaymentProbability}%` }}
            >
              <span className="bar-value">{analysis.repaymentProbability}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Growth Potential</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.growthPotential}%` }}
            >
              <span className="bar-value">{analysis.growthPotential}%</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Stability Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.stabilityScore}%` }}
            >
              <span className="bar-value">{analysis.stabilityScore}/100</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔐</div>
          <div className="step-content">
            <h4>Data Encryption</h4>
            <p>Credit data encrypted with Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">📊</div>
          <div className="step-content">
            <h4>Homomorphic Computation</h4>
            <p>Encrypted calculations without decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Selective Disclosure</h4>
            <p>Share scores without revealing raw data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">✅</div>
          <div className="step-content">
            <h4>Verifiable Proof</h4>
            <p>On-chain verification with zero-knowledge</p>
          </div>
        </div>
      </div>
    );
  };

  const filteredScores = scores.filter(score =>
    score.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    score.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CreditScoreZ 🔐</h1>
            <span className="tagline">Encrypted DID Credit Score</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted credit scoring system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating encrypted credit profiles</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted credit system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CreditScoreZ 🔐</h1>
          <span className="tagline">Encrypted DID Credit Score</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Credit Profile
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Encrypted Credit Analytics (FHE 🔐)</h2>
          {renderDashboard()}
          
          <div className="panel gradient-panel full-width">
            <h3>FHE 🔐 Privacy-Preserving Credit Scoring</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="scores-section">
          <div className="section-header">
            <h2>Credit Profiles</h2>
            <div className="header-actions">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search profiles..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="scores-list">
            {filteredScores.length === 0 ? (
              <div className="no-scores">
                <p>No credit profiles found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Profile
                </button>
              </div>
            ) : filteredScores.map((score, index) => (
              <div 
                className={`score-item ${selectedScore?.id === score.id ? "selected" : ""} ${score.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedScore(score)}
              >
                <div className="score-title">{score.name}</div>
                <div className="score-meta">
                  <span>Activity Level: {score.publicValue1}/10</span>
                  <span>Created: {new Date(score.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="score-status">
                  Status: {score.isVerified ? "✅ On-chain Verified" : "🔓 Ready for Verification"}
                  {score.isVerified && score.decryptedValue && (
                    <span className="verified-amount">Score: {score.decryptedValue}</span>
                  )}
                </div>
                <div className="score-creator">Creator: {score.creator.substring(0, 6)}...{score.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="user-history-section">
          <h3>Your Operation History</h3>
          <div className="history-list">
            {userHistory.slice(-5).map((item, index) => (
              <div key={index} className="history-item">
                <span className="history-type">{item.type === "create" ? "📝 Created" : "🔓 Decrypted"}</span>
                <span className="history-details">
                  {item.name && `${item.name} - `}Score: {item.score}
                </span>
                <span className="history-time">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {userHistory.length === 0 && (
              <div className="no-history">No operations yet</div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateScore 
          onSubmit={createScore} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingScore} 
          scoreData={newScoreData} 
          setScoreData={setNewScoreData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedScore && (
        <ScoreDetailModal 
          score={selectedScore} 
          onClose={() => { 
            setSelectedScore(null); 
            setDecryptedData({ score: null, activity: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedScore.score)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateScore: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  scoreData: any;
  setScoreData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, scoreData, setScoreData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = value.replace(/[^\d]/g, '');
      setScoreData({ ...scoreData, [name]: intValue });
    } else {
      setScoreData({ ...scoreData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-score-modal">
        <div className="modal-header">
          <h2>New Credit Profile</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Credit score will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Profile Name *</label>
            <input 
              type="text" 
              name="name" 
              value={scoreData.name} 
              onChange={handleChange} 
              placeholder="Enter profile name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Credit Score (300-850) *</label>
            <input 
              type="number" 
              name="score" 
              value={scoreData.score} 
              onChange={handleChange} 
              placeholder="Enter credit score..." 
              min="300"
              max="850"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Financial Activity Level (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="activity" 
              value={scoreData.activity} 
              onChange={handleChange} 
              placeholder="Enter activity level..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !scoreData.name || !scoreData.score || !scoreData.activity} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ScoreDetailModal: React.FC<{
  score: CreditScoreData;
  onClose: () => void;
  decryptedData: { score: number | null; activity: number | null };
  setDecryptedData: (value: { score: number | null; activity: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (score: CreditScoreData, decryptedScore: number | null, decryptedActivity: number | null) => JSX.Element;
}> = ({ score, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.score !== null) { 
      setDecryptedData({ score: null, activity: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ score: decrypted, activity: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="score-detail-modal">
        <div className="modal-header">
          <h2>Credit Profile Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="score-info">
            <div className="info-item">
              <span>Profile Name:</span>
              <strong>{score.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{score.creator.substring(0, 6)}...{score.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(score.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Activity Level:</span>
              <strong>{score.publicValue1}/10</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Credit Data</h3>
            
            <div className="data-row">
              <div className="data-label">Credit Score:</div>
              <div className="data-value">
                {score.isVerified && score.decryptedValue ? 
                  `${score.decryptedValue} (On-chain Verified)` : 
                  decryptedData.score !== null ? 
                  `${decryptedData.score} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(score.isVerified || decryptedData.score !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : score.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.score !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Privacy-Preserving Computation</strong>
                <p>Credit data remains encrypted throughout computation. Verify to decrypt and prove score validity.</p>
              </div>
            </div>
          </div>
          
          {(score.isVerified || decryptedData.score !== null) && (
            <div className="analysis-section">
              <h3>Credit Risk Analysis</h3>
              {renderAnalysisChart(
                score, 
                score.isVerified ? score.decryptedValue || null : decryptedData.score, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Credit Score:</span>
                  <strong>
                    {score.isVerified ? 
                      `${score.decryptedValue} (On-chain Verified)` : 
                      `${decryptedData.score} (Locally Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${score.isVerified ? 'verified' : 'local'}`}>
                    {score.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Activity Level:</span>
                  <strong>{score.publicValue1}/10</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!score.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


