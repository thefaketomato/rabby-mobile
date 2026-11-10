import { apiKeystone } from '@/core/apis';

import { createKeystoneHDAddressApi } from './keystoneApi';

jest.mock('@/core/apis', () => ({
  apiKeystone: {
    getAddresses: jest.fn(),
    getCurrentAccounts: jest.fn(),
    getMaxAccountLimit: jest.fn(),
    importAddress: jest.fn(),
  },
}));

const mockApiKeystone = apiKeystone as unknown as {
  getAddresses: jest.Mock;
  getCurrentAccounts: jest.Mock;
  getMaxAccountLimit: jest.Mock;
  importAddress: jest.Mock;
};

describe('createKeystoneHDAddressApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('binds every address call to the given wallet', async () => {
    const api = createKeystoneHDAddressApi('wallet-b');

    await api.getAddresses(0, 1);
    await api.getCurrentAccounts();
    await api.getMaxAccountLimit();
    await api.importAddress(2);

    expect(mockApiKeystone.getAddresses).toHaveBeenCalledWith(0, 1, 'wallet-b');
    expect(mockApiKeystone.getCurrentAccounts).toHaveBeenCalledWith('wallet-b');
    expect(mockApiKeystone.getMaxAccountLimit).toHaveBeenCalledWith('wallet-b');
    expect(mockApiKeystone.importAddress).toHaveBeenCalledWith(2, 'wallet-b');
  });

  it('keeps legacy callers working when no wallet id is supplied', async () => {
    const api = createKeystoneHDAddressApi();

    await api.getAddresses(5, 6);

    expect(mockApiKeystone.getAddresses).toHaveBeenCalledWith(5, 6, undefined);
  });
});
