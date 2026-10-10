export default {
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
  },
};
