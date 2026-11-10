import { groupKeystoneWalletAccounts } from './keystoneWalletGroups';

describe('groupKeystoneWalletAccounts', () => {
  it('splits accounts per wallet and labels groups from wallet names', () => {
    const accounts = [
      { address: '0x1', keyringId: 'aabbccdd:hd:m/44' },
      { address: '0x2', keyringId: 'aabbccdd:hd:m/44' },
      { address: '0x3', keyringId: '11223344:hd:m/44' },
    ];
    const names = new Map([
      ['aabbccdd:hd:m/44', 'Treasury'],
      ['11223344:hd:m/44', 'Keystone'],
    ]);

    const groups = groupKeystoneWalletAccounts(accounts, names);

    expect(groups).toStrictEqual([
      {
        keyringId: 'aabbccdd:hd:m/44',
        name: 'Treasury · CCDD',
        list: [accounts[0], accounts[1]],
      },
      {
        keyringId: '11223344:hd:m/44',
        name: 'Keystone · 3344',
        list: [accounts[2]],
      },
    ]);
  });

  it('falls back to an unlabeled group without wallet ids', () => {
    const accounts = [{ address: '0x1' }, { address: '0x2' }];

    const groups = groupKeystoneWalletAccounts(accounts, new Map());

    expect(groups).toStrictEqual([{ name: '', list: accounts }]);
  });

  it('keeps the group unlabeled when the wallet name is unknown', () => {
    const accounts = [{ address: '0x1', keyringId: 'aabbccdd:hd:m/44' }];

    const groups = groupKeystoneWalletAccounts(accounts, new Map());

    expect(groups).toStrictEqual([
      {
        keyringId: 'aabbccdd:hd:m/44',
        name: '',
        list: accounts,
      },
    ]);
  });
});
