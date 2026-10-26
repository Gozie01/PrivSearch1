// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Latest PrivSearch state per dataset; independent of LifeDB audit blocks.
/// @dev The owner authenticates snapshots. Consensus finality is checked by clients.
contract PrivSearchStateAnchor {
    address public immutable owner;
    struct Head { uint64 sequence; bytes32 commitment; }
    mapping(bytes32 => Head) private heads;
    event StateAnchored(bytes32 indexed datasetId, uint64 indexed sequence,
        bytes32 commitment, bytes32 previousCommitment);
    error Unauthorized();
    error InvalidState();
    error ConflictingHead();

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidState();
        owner = initialOwner;
    }

    function anchorState(bytes32 datasetId, uint64 sequence, bytes32 commitment,
        bytes32 expectedPreviousCommitment) external {
        if (msg.sender != owner) revert Unauthorized();
        if (datasetId == bytes32(0) || commitment == bytes32(0)) revert InvalidState();
        Head memory old = heads[datasetId];
        if (old.sequence == type(uint64).max || sequence != old.sequence + 1 ||
            expectedPreviousCommitment != old.commitment) revert ConflictingHead();
        heads[datasetId] = Head(sequence, commitment);
        emit StateAnchored(datasetId, sequence, commitment, old.commitment);
    }

    function getState(bytes32 datasetId) external view returns (uint64 sequence, bytes32 commitment) {
        Head memory current = heads[datasetId];
        return (current.sequence, current.commitment);
    }
}
