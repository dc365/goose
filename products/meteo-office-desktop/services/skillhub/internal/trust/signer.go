package trust

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type KeyRecord struct {
	Algorithm  string `json:"algorithm"`
	KeyID      string `json:"keyId"`
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

type PublicKey struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
}

type Signer struct {
	keyID   string
	public  ed25519.PublicKey
	private ed25519.PrivateKey
}

func OpenOrCreate(root string) (*Signer, error) {
	if root == "" {
		return nil, errors.New("trust root is required")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(root, "ed25519.json")
	data, err := os.ReadFile(path)
	if err == nil {
		var record KeyRecord
		if err := json.Unmarshal(data, &record); err != nil {
			return nil, fmt.Errorf("decode signing key: %w", err)
		}
		public, err := base64.StdEncoding.DecodeString(record.PublicKey)
		if err != nil {
			return nil, err
		}
		private, err := base64.StdEncoding.DecodeString(record.PrivateKey)
		if err != nil {
			return nil, err
		}
		if len(public) != ed25519.PublicKeySize || len(private) != ed25519.PrivateKeySize {
			return nil, errors.New("invalid Ed25519 key size")
		}
		return &Signer{keyID: record.KeyID, public: public, private: private}, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	keyID := keyIDFor(public)
	record := KeyRecord{
		Algorithm:  "ed25519",
		KeyID:      keyID,
		PublicKey:  base64.StdEncoding.EncodeToString(public),
		PrivateKey: base64.StdEncoding.EncodeToString(private),
	}
	encoded, _ := json.MarshalIndent(record, "", "  ")
	temp := path + ".tmp"
	if err := os.WriteFile(temp, append(encoded, '\n'), 0o600); err != nil {
		return nil, err
	}
	if err := os.Rename(temp, path); err != nil {
		_ = os.Remove(temp)
		return nil, err
	}
	return &Signer{keyID: keyID, public: public, private: private}, nil
}

func (s *Signer) Sign(message string) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(s.private, []byte(message)))
}

func (s *Signer) PublicKey() PublicKey {
	return PublicKey{Algorithm: "ed25519", KeyID: s.keyID, PublicKey: base64.StdEncoding.EncodeToString(s.public)}
}

func (s *Signer) KeyID() string { return s.keyID }

func Verify(publicKeyBase64, message, signatureBase64 string) bool {
	publicKey, err := base64.StdEncoding.DecodeString(publicKeyBase64)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return false
	}
	signature, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(publicKey, []byte(message), signature)
}

func Message(skillID, version, digest string) string {
	return skillID + "\n" + version + "\n" + digest
}

func keyIDFor(public ed25519.PublicKey) string {
	sum := sha256.Sum256(public)
	return "ed25519-" + hex.EncodeToString(sum[:8])
}
