import React, { useEffect, useState } from 'react';
import '../App.css';
import { AppBar, Box, Button, Card, CardContent, CircularProgress, Container, IconButton, Toolbar, Tooltip, Typography } from '@material-ui/core';
import { PublicKey } from '@solana/web3.js';
import {
  Link as RouterLink
} from 'react-router-dom';
import { accounInfoToStakeAccount as accountInfoToStakeAccount, findStakeAccountMetas, sortStakeAccountMetas, StakeAccountMeta } from '../utils/stakeAccounts';
import { StakeAccountCard } from '../components/StakeAccount';
import { ReactComponent as SolstakeLogoSvg } from '../assets/logo-gradient.svg';
import { Info } from '@material-ui/icons';
import { Connector } from '../components/Connector';
import { useWallet } from '../contexts/wallet';
import { AppSettings } from '../components/AppSettings';
import { ENDPOINTS, useConnection, useConnectionConfig } from '../contexts/connection';
import { SummaryCard } from '../components/SummaryCard';
import HelpDialog from '../components/HelpDialog';
import { STAKE_PROGRAM_ID } from '../utils/ids';

const DEMO_PUBLIC_KEY_STRING = '8BaNJXqMAEVrV7cgzEjW66G589ZmDvwajmJ7t32WpvxW';

function StakeAccounts({stakeAccountMetas}: {stakeAccountMetas: StakeAccountMeta[]}) {
  if (stakeAccountMetas.length === 0) {
    return (
      <Box m={1}>
        <Card>
          <CardContent>
            <Typography>
              No stake account found
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <>
      {stakeAccountMetas.map(
        meta => (<StakeAccountCard key={meta.address.toBase58()} stakeAccountMeta={meta} />))
      }
    </>
  );
}

function DApp() {
  const connection = useConnection();
  const { setUrl } = useConnectionConfig();
  const { wallet, connected, disconnect } = useWallet();
  const [publicKeyString, setPublicKeyString] = useState<string>();
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [stakeAccounts, setStakeAccounts] = useState<StakeAccountMeta[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setStakeAccounts(null);
    const newPublicKey = connected ? wallet?.publicKey : publicKey;
    if (newPublicKey) {
      setLoading(true);
      findStakeAccountMetas(connection, newPublicKey)
        .then(newStakeAccounts => {
          setStakeAccounts(newStakeAccounts);
          setLoading(false);
        });
    }
  }, [connection, connected, wallet?.publicKey, publicKey]);

  useEffect(() => {
    if (!wallet?.publicKey) {
      return;
    }
    let walletPublicKey = wallet.publicKey;

    const subscriptionId = connection.onProgramAccountChange(STAKE_PROGRAM_ID, async ({accountId, accountInfo}) => {
      console.log(`StakeAccount update for ${accountId.toBase58()}`);
      const index = stakeAccounts?.findIndex(extistingStakeAccountMeta => 
        extistingStakeAccountMeta.address.equals(accountId)
      ) ?? -1;
      let updatedStakeAccounts = stakeAccounts ? [...stakeAccounts] : [];

      // Ideally we should just subscribe as jsonParsed, but that isn't available through web3.js
      const parsedAccountInfo = (await connection.getParsedAccountInfo(accountId)).value;
      console.log(accountInfo.lamports, accountInfo.data, accountInfo.owner.toBase58());
      if (!parsedAccountInfo) {
        // It should be impossible to reach this scenario since we listen for specific data, it has to exist
        console.log(`${accountId.toBase58()} does not exist`);
        return;
      }
      const newStakeAccount = accountInfoToStakeAccount(parsedAccountInfo);
      if (!newStakeAccount) {
        console.log(`Could no find parsed data: ${accountId.toBase58()}`);
        return;
      }

      if (index === -1) {
        console.log(`Could not find existing stake account for address, adding: ${stakeAccounts?.length} ${newStakeAccount}`);
        const naturalStakeAccountSeedPubkeys = await Promise.all(Array.from(Array(20).keys()).map(async i => {
          const seed = `${i}`;
          return PublicKey.createWithSeed(walletPublicKey, seed, STAKE_PROGRAM_ID).then(pubkey => ({seed, pubkey}));
        }));

        const seed = naturalStakeAccountSeedPubkeys.find(element => element.pubkey.equals(accountId))?.seed ?? 'N.A.';
        updatedStakeAccounts.push({
          address: accountId,
          seed,
          lamports: parsedAccountInfo.lamports,
          stakeAccount: newStakeAccount,
          inflationRewards: [] // In 99.999% of cases this should be correct
        });
      }
      else {
        updatedStakeAccounts[index].stakeAccount = newStakeAccount;
      }

      sortStakeAccountMetas(updatedStakeAccounts);
      setStakeAccounts(updatedStakeAccounts);
    },
    connection.commitment,
    [{
      memcmp: {
        offset: 12,
        bytes: wallet.publicKey.toBase58()
      }
    }]);

    return () => {
      connection.removeProgramAccountChangeListener(subscriptionId);
    };
  }, [connection, wallet, stakeAccounts]);

  // Unfortunately we need to listen 
  useEffect(() => {
    const subscriptionIds = stakeAccounts?.map(stakeAccountMeta => {
      return connection.onAccountChange(stakeAccountMeta.address, async () => {
        console.log(`StakeAccount update for ${stakeAccountMeta.address.toBase58()}`);
        const index = stakeAccounts?.findIndex(extistingStakeAccountMeta => 
          extistingStakeAccountMeta.address.equals(stakeAccountMeta.address)
        );
        const parsedAccountInfo = (await connection.getParsedAccountInfo(stakeAccountMeta.address)).value;
        if (!parsedAccountInfo) {
          // The account can no longer be found, it has been closed
          if (index > -1) {
            let updatedStakeAccounts = [...stakeAccounts];
            updatedStakeAccounts.splice(index, 1);
            setStakeAccounts (updatedStakeAccounts);
          }
          return;
        }
      });
    });

    // Necessary subscription cleanup
    return () => {
      subscriptionIds?.forEach(id => {
        connection.removeAccountChangeListener(id);
      })
    };
  }, [connection, stakeAccounts]);
  
  return (
    <div id="dapp">
      <AppBar position="relative">
        <Toolbar>
            <RouterLink to="/" style={{width: '15%'}}>
              <Box m={1}>
                <SolstakeLogoSvg className="App-logo" />
              </Box>
            </RouterLink>
            <div style={{flexGrow: 1}}></div>
            <div style={{display: 'flex', gap: '10px', padding: '5px'}}>
              <IconButton onClick={() => { setOpen(true); }}>
                <Info />
              </IconButton>
              <Tooltip title="Use known stake account authority">
                <Button
                  variant="contained"
                  onClick={() => {
                    disconnect();
                    setUrl(ENDPOINTS[0].url);
                    setPublicKeyString(DEMO_PUBLIC_KEY_STRING);
                  }}
                >
                  Demo
                </Button>
              </Tooltip>
              <Connector />
              <AppSettings />
            </div>
        </Toolbar>
      </AppBar>
      <Box m={1} />
      <Container maxWidth="md">
        <SummaryCard
          publicKeyString={publicKeyString}
          setPublicKeyString={setPublicKeyString}
          setPublicKey={setPublicKey}
          stakeAccountMetas={stakeAccounts}
        />
        <Container>
          {loading && (
            <Box m={1}>
              <div style={{display: 'flex', justifyContent: 'center'}}>
                <CircularProgress />
              </div>
            </Box>
          )}
          {stakeAccounts && (
            <StakeAccounts stakeAccountMetas={stakeAccounts} />
          )}
        </Container>
      </Container>

      <Box m="1">
        <br />
      </Box>

      <HelpDialog
        open={open}
        handleClose={() => setOpen(false)}
      />
    </div>
  );
}

export default DApp;
